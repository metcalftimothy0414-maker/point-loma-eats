# Point Loma Eats (working name)

Food delivery for Navy personnel around Naval Base Point Loma who don't have a
car: off-base restaurant → approved on-base delivery point, brought by the
founder (sole courier for V1).

## Status: Phase 3 — restaurant browsing + cart, menu-sync schema underway

Sign-up/sign-in works (Phase 1). Installations → delivery zones → delivery
points exist as browsable/admin-managed catalog data (Phase 2). Pricing is
markup-based (`pricing_settings`: `markup_pct`/`minimum_subtotal`/
`on_demand_markup_pct`, versioned by `effective_from`) rather than the flat
delivery-fee model in the original brief — that's a deliberate pivot, not
drift. The mobile app lists restaurants, shows menus grouped by category, and
has a client-side cart (no persistence — nothing to check out against until
Phase 4's real order flow exists). `orders` is still a placeholder shell, not
the full 17-state machine.

An automated menu-sync service (`services/menu-sync/`) is in progress:
schema (`0004_menu_sync.sql`) and the `normalize.ts` normalizer are built and
tested; adapters (Toast/Square/Clover/ChowNow/generic), the orchestrator,
cron registration, and admin UI are not. See `services/menu-sync/README.md`.

## Structure

```
mobile/                 Expo (React Native + TypeScript) customer app, expo-router
supabase/migrations/    SQL migrations, applied in order
services/menu-sync/     Automated menu ingestion (schema + normalizer so far)
```

Admin dashboard (Next.js) and courier dashboard land in later phases — not
scaffolded yet, no need to carry empty folders for them.

## Local setup

1. Create a Supabase project.
2. `cd mobile && cp .env.example .env` and fill in your project's URL + anon
   key (Project Settings → API).
3. Apply the migrations in `supabase/migrations/` in order (0001–0004) via
   the Supabase SQL editor, or `supabase db push` if you've linked the
   project with the Supabase CLI.
4. `cd mobile && npm install && npm run ios` (or `android`).

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
