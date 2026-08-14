# Point Loma Eats (working name)

Food delivery for Navy personnel around Naval Base Point Loma who don't have a
car: off-base restaurant → approved on-base delivery point, brought by the
founder (sole courier for V1).

## Status: Phase 7 — admin dashboard

Sign-up/sign-in works (Phase 1). Installations → delivery zones → delivery
points exist as browsable/admin-managed catalog data (Phase 2). Pricing is
markup-based (`pricing_settings`: `markup_pct`/`minimum_subtotal`/
`on_demand_markup_pct`, versioned by `effective_from`) rather than the flat
delivery-fee model in the original brief — that's a deliberate pivot, not
drift. The mobile app lists restaurants, shows menus grouped by category, and
has a cart, checkout, and Stripe payment (Phase 3 + 4).

`orders` is the real 17-state machine from the brief. `create_order()`
re-prices every item server-side and enforces `minimum_subtotal` — the
client is never trusted with pricing. `transition_order_status()` validates
every transition against a fixed graph and checks who's allowed to make it.
Checkout goes through two Supabase Edge Functions (`create-payment-intent`,
`stripe-webhook`) — the webhook is the only thing that ever marks an order
PAID, never the client.

The courier dashboard lives in the *same* mobile app, not a separate one —
a `profiles.role = 'courier'` account gets routed to `(courier)` instead of
the customer tabs on sign-in. One account is one role at a time; there's no
role switcher, so testing both sides means two accounts (see "After you
sign up" below). It shows in-flight deliveries (everything assigned to that
courier from `COURIER_ASSIGNED` through `ARRIVED`) with a single
next-action button per order, today's order count/revenue/average order
value, restaurant + customer + delivery-point info per order, and a tappable
phone number. Deliberately **not** shown: "delivery hours worked" / revenue-
per-hour — those need real time tracking (clock in/out or similar) that
doesn't exist yet; that's genuinely Phase 8 analytics work, not this
operational screen. Also not built: maps/distance/ETA on order cards (no
Maps API configured — see brief section 36, not faking it). The courier
dashboard stays pull-to-refresh by design (see below), not because
realtime wasn't built.

The customer's order screen (`mobile/app/order/[id].tsx`) is now realtime —
`orders` is in the `supabase_realtime` publication, and the screen
subscribes to its own order's status changes rather than needing a manual
refresh. One trigger (`order_status_history_notify`) fires on every order
status change regardless of which path caused it (Stripe webhook, courier
action, admin) and calls a new Edge Function, `send-order-notification`,
which is the single place that decides which statuses are actually
notify-worthy and sends via Expo's push API. **Real limitation:** there's
no EAS project configured in this repo (`app.json` has no
`extra.eas.projectId`), so push tokens can't actually be fetched yet —
registration fails gracefully (logs, doesn't throw) rather than blocking
the app, but receiving a real push needs `eas init` and a development
build, neither done here. See `ARCHITECTURE.md` for the full design.

`services/menu-sync/` is a full pipeline: Places lookup, robots.txt-respecting
fetch, platform detection, normalize/diff/apply with the spec's auto-apply
rules, and nightly `pg_cron` scheduling. The four POS-platform adapters
(Toast/Square/Clover/ChowNow) don't parse real data yet — verified against
real pages that they're currently Cloudflare-walled or empty SPA shells, not
scrapable without either browser automation (out of bounds — see
`ARCHITECTURE.md`) or an OAuth partner API integration (a real scope
addition, not decided). `generic.ts` (Claude vision) is the adapter that
actually works, and is what runs for Point Loma Eats' real target
restaurants.

`admin/` now covers Dashboard, Orders, Restaurants, Customers,
Installations, Pricing, Payments, Refunds, Support, and Menu Sync — closing
a real gap along the way: restaurants, menu items, installations, delivery
zones/points, and pricing previously had **no UI at all**, only direct SQL.
Refunds now actually calls Stripe (`refund-payment`, a new Edge Function) —
`REFUND_PENDING`/`REFUNDED` were reachable states since Phase 4 with
nothing that issued one. Deliberately **not** built: Analytics (still its
own later phase — see Roadmap) and Incidents/Settings (the brief never
defines what either would contain beyond what Support and env vars already
cover). See `ARCHITECTURE.md` for the full section-by-section design and
scope reasoning.

## Structure

```
mobile/                 Expo (React Native + TypeScript) customer + courier app, expo-router
admin/                  Next.js admin app — Dashboard, Orders, Restaurants, Customers,
                         Installations, Pricing, Payments, Refunds, Support, Menu Sync
supabase/migrations/    SQL migrations, applied in order
supabase/functions/     Deno Edge Functions (checkout, webhook, notifications, refunds)
services/menu-sync/     Automated menu ingestion pipeline
```

## Local setup

1. Create a Supabase project and a Stripe account (test mode is fine).
2. `cd mobile && cp .env.example .env` and fill in your project's URL + anon
   key (Project Settings → API) and your Stripe publishable key.
3. Apply the migrations in `supabase/migrations/` in order (0001–0009) via
   the Supabase SQL editor, or `supabase db push` if you've linked the
   project with the Supabase CLI. `0005`/`0008` need `pg_cron`/`pg_net`
   enabled on your project (Database → Extensions).
4. Deploy the Edge Functions: `supabase functions deploy create-payment-intent stripe-webhook send-order-notification refund-payment`,
   then `supabase secrets set STRIPE_SECRET_KEY=... STRIPE_WEBHOOK_SECRET=... NOTIFICATION_TRIGGER_SECRET=... ADMIN_ACTION_SECRET=...`
   (`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are
   injected automatically). Point a Stripe webhook at the deployed
   `stripe-webhook` URL for `payment_intent.succeeded` and
   `payment_intent.payment_failed`. Then point the DB at the deployed
   notification function (see `supabase/functions/README.md` for the exact
   `alter database` commands).
5. `cd mobile && npm install && npm run ios` (or `android`).
6. Admin app: `cd admin && cp .env.example .env.local`, fill in the service
   role key, a Basic Auth username/password, and (once deployed)
   `REFUND_PAYMENT_URL`/`ADMIN_ACTION_SECRET`, `npm install && npm run dev`.

## After you (the founder) sign up

New accounts default to `role = 'customer'`. Role changes are intentionally
not client-settable (RLS blocks it — see migration comments). To make your
own account the courier — and see the courier dashboard instead of the
customer app on sign-in — run in the Supabase SQL editor:

```sql
update profiles set role = 'courier' where id = '<your-auth-user-id>';
insert into couriers (id) values ('<your-auth-user-id>');
```

That account can no longer browse/order as a customer once it's a courier
(one role at a time, no switcher) — use a second account to test the
customer side.

## Roadmap

Phase 8: deeper analytics (most popular restaurant/delivery point, peak
ordering hour, contribution margin trends, customer acquisition cost — the
Dashboard already covers today's orders/revenue/avg order value/avg tip/
cancellations, avg delivery time, orders & revenue per hour, repeat-customer
rate).
Phase 9: tests, security pass, polish.

Full spec lives in the project's CLAUDE.md-equivalent brief; this README
tracks what's actually built.
