import { z } from 'zod';
import type { AdapterResult, NormalizedMenu, NormalizedMenuCategory, NormalizedMenuItem } from './types.ts';

const rawMenuItemSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).nullish(),
  price: z.union([z.string(), z.number()]),
  externalId: z.string().trim().min(1).nullish(),
  available: z.boolean().optional(),
});

const rawMenuCategorySchema = z.object({
  name: z.string().trim().min(1),
  items: z.array(rawMenuItemSchema),
});

const adapterResultSchema = z.object({
  sourcePlatform: z.enum(['toast', 'square', 'clover', 'chownow', 'generic']),
  sourceUrl: z.string().url(),
  categories: z.array(rawMenuCategorySchema),
  confidence: z.number().min(0).max(1),
});

/**
 * Parses a price into a canonical 2-decimal number, or null if it can't be
 * trusted ("Market Price", empty string, zero/negative). A null price drops
 * the item rather than guessing — skipping an item beats silently shipping
 * a wrong one, given a bad parse costs real margin.
 */
function parsePrice(raw: string | number): number | null {
  const value = typeof raw === 'number' ? raw : Number(raw.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100) / 100;
}

/**
 * Turns any adapter's raw output into the canonical shape diff.ts/apply.ts
 * (not built yet) work with.
 *
 * Throws on structurally invalid input (missing name, unparseable payload
 * shape) — that's a hard adapter bug, not something to paper over. An
 * individual item with an unparseable price is dropped, not thrown on, and
 * drags the run's confidence down instead — a mostly-broken parse should
 * still land below the auto-apply threshold, not error out and lose the
 * partial-but-good data alongside it.
 */
export function normalize(result: AdapterResult, restaurantId: string): NormalizedMenu {
  const parsed = adapterResultSchema.parse(result);

  let droppedItems = 0;
  let totalItems = 0;

  const categories: NormalizedMenuCategory[] = parsed.categories.map((category, categoryIndex) => {
    const items: NormalizedMenuItem[] = [];

    for (const raw of category.items) {
      totalItems += 1;
      const basePrice = parsePrice(raw.price);
      if (basePrice === null) {
        droppedItems += 1;
        continue;
      }
      items.push({
        name: raw.name,
        description: raw.description ?? null,
        basePrice,
        isAvailable: raw.available ?? true,
        sourceItemId: raw.externalId ?? null,
        confidence: parsed.confidence,
      });
    }

    return { name: category.name, sortOrder: categoryIndex, items };
  });

  // Dropped items are exactly the signal the > 30% churn / < 0.85 confidence
  // review rules exist to catch — fold it into the run's confidence rather
  // than only surfacing it as a side channel the caller has to remember to check.
  const dropRate = totalItems === 0 ? 0 : droppedItems / totalItems;
  const confidence = Math.max(0, parsed.confidence - dropRate);

  return {
    restaurantId,
    sourcePlatform: parsed.sourcePlatform,
    sourceUrl: parsed.sourceUrl,
    categories,
    confidence,
  };
}
