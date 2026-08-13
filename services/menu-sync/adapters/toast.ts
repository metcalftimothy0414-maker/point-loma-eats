import { fetchForSync } from '../fetch.ts';
import type { AdapterResult } from '../types.ts';

/**
 * order.toasttab.com sits behind a Cloudflare managed challenge — verified
 * 2026-08-13: even a plain robots.txt request comes back as a
 * "Just a moment..." interstitial (403). fetchForSync() detects that
 * pattern and throws FetchBlockedError; nothing here tries to solve or
 * route around it (no header spoofing, no headless-browser fingerprint
 * masking) — that's explicitly out of bounds.
 *
 * If the wall isn't hit for a given restaurant (Cloudflare config differs,
 * or changes over time), there is still no verified public JSON shape to
 * parse — Toast's actual documented integration path is their Partner API
 * (OAuth, invite-only partnership), a different integration shape than
 * "fetch a public page," requiring per-restaurant credential storage this
 * schema doesn't have yet. So: fetch, and if it unexpectedly succeeds,
 * fail loudly with a clear message instead of guessing at a schema that
 * was never actually observed.
 */
export async function run(url: string): Promise<AdapterResult> {
  await fetchForSync(url);
  throw new Error(
    'toast.ts: fetched successfully but has no verified menu JSON shape to parse (see file comment). ' +
      'Needs either a confirmed structure from a real unblocked response, or a Toast Partner API integration.'
  );
}
