import { fetchForSync } from '../fetch.ts';
import type { AdapterResult } from '../types.ts';

/**
 * square.site pages do embed server-side JSON (window.__BOOTSTRAP_STATE__
 * — verified 2026-08-13 against a real Square Online restaurant site), but
 * it's Square's own internal site-builder state, not a documented menu
 * format: deeply nested (site config, onboarding flags, editor version
 * history...), with only catalogSiteId/squareMerchantId visible near the
 * top rather than confirmed inline item data — the actual catalog may load
 * separately, client-side. Reverse-engineering an undocumented, frequently
 * redeployed internal blob is exactly the kind of fragile parsing this
 * project exists to avoid — a bad parse costs real margin.
 *
 * Square's real documented path is the Catalog API (`GET /v2/catalog/list`,
 * OAuth per-merchant) — stable and well-documented, but a different
 * integration shape needing per-restaurant credential storage this schema
 * doesn't have yet.
 */
export async function run(url: string): Promise<AdapterResult> {
  await fetchForSync(url);
  throw new Error(
    'square.ts: window.__BOOTSTRAP_STATE__ is undocumented internal state, not a stable menu format ' +
      '(see file comment). Needs either a confirmed item-data path or a Square Catalog API integration.'
  );
}
