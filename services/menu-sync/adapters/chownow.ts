import { fetchForSync } from '../fetch.ts';
import type { AdapterResult } from '../types.ts';

/**
 * ChowNow's ordering pages (eat.chownow.com) are also a client-rendered
 * SPA — verified 2026-08-13: the served HTML is a Create React App shell
 * that preconnects to api.chownow.com for data; there's no server-rendered
 * menu JSON in the initial fetch. Same situation as clover.ts, same
 * reasoning for not executing the page's JS to chase it down.
 *
 * ChowNow does have a partner API, but it's partnership-gated (OAuth per
 * restaurant) — a different integration shape needing per-restaurant
 * credential storage this schema doesn't have yet.
 */
export async function run(url: string): Promise<AdapterResult> {
  await fetchForSync(url);
  throw new Error(
    'chownow.ts: ordering pages render menu data client-side via api.chownow.com — ' +
      'nothing to parse from a plain fetch (see file comment).'
  );
}
