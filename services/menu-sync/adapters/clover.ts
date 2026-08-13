import { fetchForSync } from '../fetch.ts';
import type { AdapterResult } from '../types.ts';

/**
 * clover.com/online-ordering pages are a client-rendered SPA shell —
 * verified 2026-08-13: the raw HTML is ~3.5KB, just a `<div id="root">`
 * and a bootstrap script; menu data loads afterward via Clover's internal
 * olov2service API once the JS app runs. There is nothing embedded in
 * what fetchForSync() gets back to parse. Executing the page's JS to get
 * there would mean running a real browser against it — edging toward the
 * fingerprinting/evasion territory we're told not to do, for data that
 * would still be coming from an undocumented internal endpoint even then.
 *
 * The real integration path is Clover's actual REST API (Inventory/Item
 * endpoints, documented, OAuth per-merchant) — a different integration
 * shape needing per-restaurant credential storage this schema doesn't have
 * yet.
 */
export async function run(url: string): Promise<AdapterResult> {
  await fetchForSync(url);
  throw new Error(
    'clover.ts: online-ordering pages render menu data client-side via an undocumented internal API — ' +
      'nothing to parse from a plain fetch (see file comment).'
  );
}
