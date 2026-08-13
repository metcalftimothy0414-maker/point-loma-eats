# Point Loma Eats (working name)

Food delivery for Navy personnel around Naval Base Point Loma who don't have a
car: off-base restaurant → approved on-base delivery point, brought by the
founder (sole courier for V1).

## Status: Phase 2 — installations/zones/points, pricing engine

Sign-up/sign-in works (Phase 1). Installations → delivery zones → delivery
points exist as browsable/admin-managed catalog data. Pricing is markup-based
(`pricing_settings`: `markup_pct`/`minimum_subtotal`/`on_demand_markup_pct`,
versioned by `effective_from`) rather than the flat delivery-fee model in the
original brief — that's a deliberate pivot, not drift. A minimal
`restaurants`/`menu_categories`/`menu_items` and `orders` shell exists only so
the pricing columns have somewhere real to attach; there's no menu UI, cart,
checkout, payments, or order state machine yet (Phases 3–4). No mobile screens
consume any of this yet — it's schema only so far.

## Structure

```
mobile/                Expo (React Native + TypeScript) customer app, expo-router
supabase/migrations/   SQL migrations, applied in order
```

Admin dashboard (Next.js) and courier dashboard land in later phases — not
scaffolded yet, no need to carry empty folders for them.

## Local setup

1. Create a Supabase project.
2. `cd mobile && cp .env.example .env` and fill in your project's URL + anon
   key (Project Settings → API).
3. Apply the migrations in `supabase/migrations/` in order (0001, 0002, 0003)
   via the Supabase SQL editor, or `supabase db push` if you've linked the
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

Phase 3: real restaurant/menu management + browsing UI, cart.
Phase 4: checkout, Stripe payments, real order state machine (the current
`orders` table is a placeholder shell, not the full 17-state machine).
Phase 5: founder courier dashboard, delivery workflow.
Phase 6: order tracking, notifications.
Phase 7: admin dashboard (Next.js).
Phase 8: analytics (revenue/delivery-hour, repeat rate, etc.).
Phase 9: tests, security pass, polish.

Full spec lives in the project's CLAUDE.md-equivalent brief; this README
tracks what's actually built.
