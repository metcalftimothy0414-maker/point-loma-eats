import { createRequire } from 'node:module';

// robots-parser ships a self-contradictory .d.ts (an ambient `declare
// module` alongside its own `export default`), which breaks a normal
// import's typing. It's a plain CJS module, so require() + our own minimal
// type is simpler than fighting the broken shipped types.
const require = createRequire(import.meta.url);
const robotsParser = require('robots-parser') as (
  url: string,
  contents: string
) => {
  isAllowed(url: string, ua?: string): boolean | undefined;
  isDisallowed(url: string, ua?: string): boolean | undefined;
  getCrawlDelay(ua?: string): number | undefined;
};

const USER_AGENT =
  'PointLomaEatsMenuSync/1.0 (+https://github.com/point-loma-eats; automated menu sync, contact via repo issues)';

const DEFAULT_MIN_DELAY_MS = 1000; // 1 req/sec per domain, per the spec

const lastFetchAtByOrigin = new Map<string, number>();
const minDelayMsByOrigin = new Map<string, number>();

export class FetchBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchBlockedError';
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getMinDelayMs(origin: string): Promise<number> {
  const cached = minDelayMsByOrigin.get(origin);
  if (cached !== undefined) return cached;

  let delayMs = DEFAULT_MIN_DELAY_MS;
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) {
      const robots = robotsParser(`${origin}/robots.txt`, await res.text());
      const crawlDelaySec = robots.getCrawlDelay(USER_AGENT);
      if (crawlDelaySec) delayMs = Math.max(delayMs, crawlDelaySec * 1000);
    }
  } catch {
    // Unreachable robots.txt: fall back to the 1 req/sec default rather
    // than treating "couldn't check" as "no restrictions."
  }

  minDelayMsByOrigin.set(origin, delayMs);
  return delayMs;
}

async function waitForRateLimit(origin: string): Promise<void> {
  const minDelayMs = await getMinDelayMs(origin);
  const last = lastFetchAtByOrigin.get(origin);
  if (last !== undefined) {
    const wait = minDelayMs - (Date.now() - last);
    if (wait > 0) await sleep(wait);
  }
  lastFetchAtByOrigin.set(origin, Date.now());
}

const BOT_CHALLENGE_PATTERN = /Just a moment|Enable JavaScript and cookies to continue|cf-challenge|__cf_chl_/i;

/**
 * Fetches a URL for menu sync: honors robots.txt (throws FetchBlockedError
 * if disallowed), rate-limits to at least 1 req/sec per origin (or the
 * site's own stricter crawl-delay), identifies honestly via User-Agent, and
 * treats a bot-challenge response (Cloudflare et al.) as a block rather
 * than an error to retry past. There is no retry-with-different-headers,
 * no proxy rotation, no fingerprint masking here by design — a block gets
 * logged and surfaced for manual handling, never worked around.
 */
export async function fetchForSync(url: string): Promise<string> {
  const origin = new URL(url).origin;

  try {
    const robotsRes = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': USER_AGENT } });
    if (robotsRes.ok) {
      const robots = robotsParser(`${origin}/robots.txt`, await robotsRes.text());
      if (robots.isDisallowed(url, USER_AGENT)) {
        throw new FetchBlockedError(`robots.txt disallows ${url}`);
      }
    }
  } catch (err) {
    if (err instanceof FetchBlockedError) throw err;
    // Unreachable/malformed robots.txt: treat as "no restrictions stated,"
    // not as a block — this is the same fallback getMinDelayMs uses.
  }

  await waitForRateLimit(origin);

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

  if (res.status === 403 || res.status === 503) {
    throw new FetchBlockedError(`${url} returned ${res.status} (likely a bot-challenge/block)`);
  }
  if (!res.ok) {
    throw new Error(`${url} returned ${res.status}`);
  }

  const body = await res.text();
  if (BOT_CHALLENGE_PATTERN.test(body)) {
    throw new FetchBlockedError(`${url} served a bot-challenge interstitial instead of real content`);
  }

  return body;
}
