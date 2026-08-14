# Point Loma Eats (working name)

Food delivery for Navy personnel around Naval Base Point Loma who don't have a
car: off-base restaurant → approved on-base delivery point, brought by the
founder (sole courier for V1).

## Status: Phase 4 — checkout, Stripe payments, real order state machine

Sign-up/sign-in works (Phase 1). Installations → delivery zones → delivery
points exist as browsable/admin-managed catalog data (Phase 2). Pricing is
markup-based (`pricing_settings`: `markup_pct`/`minimum_subtotal`/
`on_demand_markup_pct`, versioned by `effective_from`) rather than the flat
delivery-fee model in the original brief — that's a deliberate pivot, not
drift. The mobile app lists restaurants, shows menus grouped by category, and
has a cart, checkout, and Stripe payment (Phase 3 + 4).

`orders` is now the real 17-state machine from the brief, not a placeholder.
`create_order()` re-prices every item server-side and enforces
`minimum_subtotal` — the client is never trusted with pricing.
`transition_order_status()` validates every transition against a fixed graph
and checks who's allowed to make it (customer can cancel their own order,
the assigned courier can advance their own delivery states, everything else
is admin/service-role only). Checkout goes through two Supabase Edge
Functions (`create-payment-intent`, `stripe-webhook`) — the webhook is the
only thing that ever marks an order PAID, never the client. There's no
courier dashboard yet (Phase 5), so the automated flow stops at
`COURIER_ASSIGNED` once payment succeeds — the sole V1 courier gets
auto-assigned, but accepting and advancing the order needs a UI that doesn't
exist yet.

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
supabase/functions/     Deno Edge Functions (Stripe checkout + webhook)
services/menu-sync/     Automated menu ingestion pipeline
```

Courier dashboard lands in a later phase — not scaffolded yet.

## Local setup

1. Create a Supabase project and a Stripe account (test mode is fine).
2. `cd mobile && cp .env.example .env` and fill in your project's URL + anon
   key (Project Settings → API) and your Stripe publishable key.
3. Apply the migrations in `supabase/migrations/` in order (0001–0006) via
   the Supabase SQL editor, or `supabase db push` if you've linked the
   project with the Supabase CLI. `0005` needs `pg_cron`/`pg_net` enabled on
   your project (Database → Extensions).
4. Deploy the Edge Functions: `supabase functions deploy create-payment-intent stripe-webhook`,
   then `supabase secrets set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=...`
   (`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are
   injected automatically). Point a Stripe webhook at the deployed
   `stripe-webhook` URL for `payment_intent.succeeded` and
   `payment_intent.payment_failed`.
5. `cd mobile && npm install && npm run ios` (or `android`).
6. Admin app: `cd admin && cp .env.example .env.local`, fill in the service
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

Phase 5: founder courier dashboard, delivery workflow (accept, mark picked
up/en route/arrived — the state machine and auto-assignment already exist,
this is the UI to actually drive it past COURIER_ASSIGNED).
Phase 6: live order tracking (realtime, not the point-in-time confirmation
screen that exists now), notifications.
Phase 7: full admin dashboard (Next.js) — Orders, Customers, full Pricing UI,
Analytics, Payments, Refunds, Support, Incidents, Settings. (Menu Sync
already exists in `admin/`.)
Phase 8: analytics (revenue/delivery-hour, repeat rate, etc.).
Phase 9: tests, security pass, polish.

Full spec lives in the project's CLAUDE.md-equivalent brief; this README
tracks what's actually built.
