# Point Loma Eats (working name)

Food delivery for Navy personnel around Naval Base Point Loma who don't have a
car: off-base restaurant → approved on-base delivery point, brought by the
founder (sole courier for V1).

## Status: Phase 3 done, plus an automated menu-sync pipeline

Sign-up/sign-in works (Phase 1). Installations → delivery zones → delivery
points exist as browsable/admin-managed catalog data (Phase 2). Pricing is
markup-based (`pricing_settings`: `markup_pct`/`minimum_subtotal`/
`on_demand_markup_pct`, versioned by `effective_from`) rather than the flat
delivery-fee model in the original brief — that's a deliberate pivot, not
drift. The mobile app lists restaurants, shows menus grouped by category, and
has a client-side cart (no persistence — nothing to check out against until
Phase 4's real order flow exists). `orders` is still a placeholder shell, not
the full 17-state machine.

`services/menu-sync/` is a full pipeline: Places lookup, robots.txt-respecting
fetch, platform detection, normalize/diff/apply with the spec's auto-apply
rules, and nightly `pg_cron` scheduling. The four POS-platform adapters
(Toast/Square/Clover/ChowNow) don't parse real data yet — verified against
real pages that they're currently Cloudflare-walled or empty SPA shells, not
scrapable without either browser automation (out of bounds — see
`ARCHITECTURE.md`) or an OAuth partner API integration (a real scope
addition, not decided). `generic.ts` (Claude vision) is the adapter that
actually works, and is what runs for Point Loma Eats' real target
restaurants. `admin/` is a new Next.js app with just the Menu Sync review
section — not the full Phase 7 admin dashboard. See `ARCHITECTURE.md` for
the full pipeline and source policy.

## Structure

```
mobile/                 Expo (React Native + TypeScript) customer app, expo-router
admin/                  Next.js admin app — Menu Sync section only so far
supabase/migrations/    SQL migrations, applied in order
services/menu-sync/     Automated menu ingestion pipeline
```

Courier dashboard lands in a later phase — not scaffolded yet.

## Local setup

1. Create a Supabase project.
2. `cd mobile && cp .env.example .env` and fill in your project's URL + anon
   key (Project Settings → API).
3. Apply the migrations in `supabase/migrations/` in order (0001–0005) via
   the Supabase SQL editor, or `supabase db push` if you've linked the
   project with the Supabase CLI. `0005` needs `pg_cron`/`pg_net` enabled on
   your Supabase project (Database → Extensions).
4. `cd mobile && npm install && npm run ios` (or `android`).
5. Admin app: `cd admin && cp .env.example .env.local`, fill in the service
   role key and a Basic Auth username/password, `npm install && npm run dev`.

## After you (the founder) sign up

New accounts default to `role = 'customer'`. Role changes are intentionally
not client-settable (RLS blocks it — see migration comments). To make your
own account the courier, run in the Supabase SQL editor:

```sql
update profiles set role = 'courier' where id = '<your-auth-user-id>';
insert into couriers (id) values ('<your-auth-user-id>');
```

## Roadmap

Phase 4: checkout, Stripe payments, real order state machine (the current
`orders` table is a placeholder shell, not the full 17-state machine).
Phase 5: founder courier dashboard, delivery workflow.
Phase 6: order tracking, notifications.
Phase 7: admin dashboard (Next.js).
Phase 8: analytics (revenue/delivery-hour, repeat rate, etc.).
Phase 9: tests, security pass, polish.

Full spec lives in the project's CLAUDE.md-equivalent brief; this README
tracks what's actually built.
