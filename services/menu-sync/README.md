# menu-sync

Automated menu ingestion: Google Places + restaurant sites + Toast/Square/
Clover/ChowNow → normalized menu → diff against current DB state → auto-apply
or queue for review. Nightly, one restaurant at a time.

## Status: schema + normalizer only

Built so far:
- `../supabase/migrations/0004_menu_sync.sql` — `menu_sync_runs`,
  `menu_item_changes`, plus `menu_items`/`restaurants` columns.
- `types.ts` — the `AdapterResult` interface every adapter will implement,
  and the `NormalizedMenu` shape `normalize.ts` produces.
- `normalize.ts` — turns an `AdapterResult` into a `NormalizedMenu`. Drops
  items with an unparseable price rather than guessing, and discounts the
  run's confidence by the drop rate so a partially-broken parse still lands
  below the 0.85 auto-apply threshold instead of shipping silently wrong.
- `normalize.test.ts` — `node --test`, no framework. Run: `npm test`.

Not built yet: `places.ts`, `detect.ts`, the five adapters, `diff.ts`,
`apply.ts`, `index.ts` orchestrator, cron registration, admin UI, or
`ARCHITECTURE.md` updates. Sync never writes `display_price` — that stays
derived from `base_price` by the pricing trigger in
`0003_pricing_catalog_orders.sql`; this service only ever writes `base_price`.

## Local dev

```
npm install
npm run typecheck
npm test
```

No build step — runs as plain `.ts` via Node's native type stripping
(`node --experimental-strip-types`), so relative imports use real `.ts`
extensions rather than the usual compiled-`.js` convention.
