# menu-sync

Automated menu ingestion: Google Places + restaurant sites + Toast/Square/
Clover/ChowNow → normalized menu → diff against current DB state → auto-apply
or queue for review. Nightly, one restaurant at a time.

See `../ARCHITECTURE.md` for the full pipeline diagram, source policy, and
auto-apply rules table.

## Status: pipeline built, four adapters intentionally not functional yet

- `places.ts` — Google Places API (New) lookup. Real, documented, public API.
- `fetch.ts` — shared fetch respecting robots.txt (incl. crawl-delay),
  rate-limited to ≥1 req/sec/domain, treats a Cloudflare-style bot-challenge
  response as a block rather than something to retry past.
- `detect.ts` — platform detection by hostname, falling back to HTML sniffing.
- `adapters/toast.ts` / `square.ts` / `clover.ts` / `chownow.ts` — fetch,
  then throw a clear error. Verified 2026-08-13 against real pages: Toast is
  Cloudflare-walled, Clover/ChowNow serve an empty client-rendered SPA shell,
  Square only embeds undocumented internal state. None are scrapable via
  plain fetch today — see file comments and `../ARCHITECTURE.md` for why,
  and what the real fix (each platform's OAuth partner API) would need.
- `adapters/generic.ts` — Claude vision fallback via the Anthropic SDK. This
  is the adapter that actually works, and given `detect.ts` only routes the
  four platform hostnames elsewhere, it's what runs for real Point Loma Eats
  restaurants (small independent sites). API cost per run isn't budgeted yet.
- `normalize.ts` — `AdapterResult` → `NormalizedMenu`. Drops unparseable-price
  items rather than guessing, discounts run confidence by the drop rate.
- `diff.ts` — matches by `source_item_id` then name; detects price/
  availability/new/delete changes.
- `apply.ts` — auto_applied vs pending_review per the spec's rules; writes
  `base_price` only (`display_price` stays trigger-derived); re-guards
  `manual_override` at the write layer.
- `index.ts` — per-restaurant + nightly-batch orchestration, records every
  outcome as a `menu_sync_runs` row, 3-consecutive-failure → `needs_attention`.
- `http-server.ts` — minimal stdlib-http trigger endpoint for `pg_cron`/
  `pg_net` (`../supabase/migrations/0005_menu_sync_cron.sql`) to call.
- 25 passing tests: `node --test`, no framework. Run: `npm test`.

Not built / not decided: OAuth partner API integration for the four POS
platforms (needs per-restaurant encrypted credential storage — a real scope
addition), where this service actually deploys to (the cron trigger URL is
an unset placeholder until then), and a Claude API cost budget.

## Local dev

```
npm install
npm run typecheck
npm test
```

No build step — runs as plain `.ts` via Node's native type stripping
(`node --experimental-strip-types`), so relative imports use real `.ts`
extensions rather than the usual compiled-`.js` convention.

Required env vars at runtime (not needed for typecheck/test):
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`,
`GOOGLE_PLACES_API_KEY`, optionally `MENU_SYNC_TRIGGER_SECRET`/`PORT` for
`http-server.ts`.
