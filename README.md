# Point Loma Eats (working name)

Food delivery for Navy personnel around Naval Base Point Loma who don't have a
car: off-base restaurant → approved on-base delivery point, brought by the
founder (sole courier for V1).

## Status: Phase 1 — project setup, database, auth, basic navigation

Nothing past sign-up/sign-in exists yet. No restaurants, no orders, no
payments. See `mobile/app` for the current screens.

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
3. Apply `supabase/migrations/0001_init.sql` via the Supabase SQL editor, or
   `supabase db push` if you've linked the project with the Supabase CLI.
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

Phase 2: installations, delivery zones, delivery points.
Phase 3: restaurants, menus, cart.
Phase 4: checkout, Stripe payments, orders.
Phase 5: founder courier dashboard, delivery workflow.
Phase 6: order tracking, notifications.
Phase 7: admin dashboard (Next.js).
Phase 8: analytics (revenue/delivery-hour, repeat rate, etc.).
Phase 9: tests, security pass, polish.

Full spec lives in the project's CLAUDE.md-equivalent brief; this README
tracks what's actually built.
