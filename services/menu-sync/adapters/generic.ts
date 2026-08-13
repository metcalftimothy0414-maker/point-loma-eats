import Anthropic from '@anthropic-ai/sdk';
import type { AdapterResult } from '../types.ts';

const MODEL = 'claude-sonnet-5';

const SYSTEM_PROMPT = `You extract restaurant menu data from raw HTML or a PDF into strict JSON.

Output ONLY a JSON object matching this exact shape — no markdown code fences, no commentary before or after it:

{
  "categories": [
    {
      "name": string,
      "items": [
        { "name": string, "description": string | null, "price": string, "available": boolean }
      ]
    }
  ],
  "confidence": number
}

Rules:
- price is the item's raw listed price as text (e.g. "12.99" or "$12.99") — do not convert or compute it.
- confidence is your own confidence in this extraction, 0 to 1. Lower it for unclear/ambiguous prices
  (ranges, "market price", handwriting, low-quality scans), not just missing data.
- available is true unless the item is explicitly marked out of stock/86'd/sold out.
- If you cannot find a menu in the input at all, return { "categories": [], "confidence": 0 }.
- Never invent items, prices, or descriptions that aren't in the input.`;

/**
 * Claude-vision fallback for restaurants not on a recognized POS platform.
 * In practice, since detect.ts only routes toast/square/clover/chownow for
 * those exact hostnames, this is the adapter that actually runs for most
 * of Point Loma Eats' target restaurants — small independent places with a
 * plain website, not enterprise POS ordering pages (see toast.ts/
 * square.ts/clover.ts/chownow.ts for why those four currently fall
 * through to 'blocked' rather than a real parse).
 *
 * Cost note: each run is a real Claude API call, billed per restaurant per
 * sync (nightly). Not sized/budgeted yet — deliberately deferred until
 * this is running against a real restaurant list, per direction.
 */
export async function run(
  sourceUrl: string,
  content: string | Buffer,
  contentType: 'html' | 'pdf'
): Promise<AdapterResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set — generic.ts cannot run without it.');
  }

  const client = new Anthropic({ apiKey });

  const userContent: Anthropic.MessageParam['content'] =
    contentType === 'pdf'
      ? [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: (content as Buffer).toString('base64') },
          },
          { type: 'text', text: 'Extract the menu from this PDF.' },
        ]
      : [{ type: 'text', text: `Extract the menu from this HTML:\n\n${content}` }];

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('generic.ts: Claude returned no text content');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch {
    throw new Error(`generic.ts: Claude response was not valid JSON: ${textBlock.text.slice(0, 200)}`);
  }

  // Deliberately not deeply validated here — normalize.ts's zod schema is
  // the single place that validates AdapterResult shape, for every
  // adapter. Duplicating that check here would just be two places that
  // can disagree about what's valid.
  const shape = parsed as { categories?: unknown; confidence?: unknown };
  return {
    sourcePlatform: 'generic',
    sourceUrl,
    categories: (shape.categories ?? []) as AdapterResult['categories'],
    confidence: typeof shape.confidence === 'number' ? shape.confidence : 0,
  };
}
