# Architecture

## Structure

```
mobile/                 Expo (React Native + TypeScript) customer app, expo-router
admin/                  Next.js admin app — currently just the Menu Sync section
supabase/migrations/    SQL migrations, applied in order, single source of truth for the schema
supabase/functions/     Deno Edge Functions — Stripe checkout + webhook only so far
services/menu-sync/     Automated menu ingestion pipeline (Node, standalone deployable)
```

Backend is Supabase end to end — Postgres + Auth + RLS + Realtime, plus Edge
Functions for the two things Postgres genuinely can't do itself: calling
Stripe, and verifying Stripe's webhook signature. No separate API server for
the customer/courier apps. `services/menu-sync` is the one piece of backend
logic that lives fully outside Supabase, because it needs to make outbound
HTTP calls (restaurant sites, Google Places, the Claude API) on a nightly
schedule, not in response to a request.

Security model throughout: RLS denies by default, an `is_admin()` helper
(checks `profiles.role`) gates admin policies, and anything that would leak
margin (`pricing_settings`, `menu_items.base_price`, `orders.food_cost`/
`gross_margin`) is additionally locked down via column-level `REVOKE`/
`GRANT` or has no RLS policy granting client access at all — see comments
in the migrations for the specifics and reasoning per table.

## Checkout & order state machine

**Goal:** a customer can pay once and have that produce exactly one order in
exactly one place, with a total the client never got to dictate, and a
status that only moves through legal transitions made by whoever's actually
allowed to make them.

### Pricing at checkout

No delivery or service fee line items in this model — the customer pays
`sum(display_price * quantity)` plus an optional tip. `display_price`
already has the markup baked in (see `0003_pricing_catalog_orders.sql`), so
checkout math is just summing what's already on the menu.

### Flow

```
Client (mobile)                Edge Function                    Postgres                 Stripe
  |  cart -> checkout screen        |                               |                       |
  |  invoke create-payment-intent ->|                               |                       |
  |                                 |-- create_order() (user JWT) ->|                       |
  |                                 |<---- order_id, customer_total-|                       |
  |                                 |-- create PaymentIntent ---------------------------->  |
  |                                 |<----------------------------------- client_secret --  |
  |                                 |-- insert payments row (service role) --------------->|
  |                                 |-- transition_order_status(PAYMENT_PENDING) --------->|
  |  <---- client_secret -----------|                               |                       |
  |  present Stripe PaymentSheet                                    |                       |
  |  (card entry happens entirely inside Stripe's SDK — this app never sees card details)   |
  |                                 |                               |         webhook <------|  payment_intent.succeeded
  |                                 |         stripe-webhook: verify signature, then:        |
  |                                 |         transition_order_status(PAID)                  |
  |                                 |         confirm_and_assign_order() -> CONFIRMED,        |
  |                                 |         then COURIER_ASSIGNED if a courier exists       |
```

`create_order()` (SQL function, `SECURITY DEFINER`) is the only path that
creates an order:
- Re-looks-up every item's price from `menu_items` server-side — the client
  sends `menu_item_id`/`quantity` pairs, never a price.
- Enforces `minimum_subtotal` from `current_pricing_settings()`, which the
  client can't read directly (see the Menu sync section below for why that
  function is locked down).
- Snapshots `name`/`unit_price` into `order_items` at order time —
  `menu_items.display_price` can change later (manual edit, a menu sync
  run), and an order must never silently re-price itself against current
  catalog state.
- Fully atomic: any failure (empty cart, negative tip, unavailable item,
  wrong restaurant, below minimum) rolls back the entire attempt, including
  the order row itself. Never a half-created order.

`transition_order_status()` is the only path that changes `orders.status`.
Every call is checked against a fixed transition graph
(`is_valid_order_transition`) *and* against who's allowed to make that
specific transition:

| Transition target | Who |
|---|---|
| `CANCELLED` | the order's own customer, or admin |
| `COURIER_ACCEPTED` … `DELIVERED` | the order's assigned courier, or admin |
| everything else (`PAYMENT_PENDING`, `PAID`, `CONFIRMED`, `COURIER_ASSIGNED`, `REFUND_PENDING`, `REFUNDED`, `DISPUTED`) | admin or the service role only |

That last row is what makes the webhook the only thing that can ever mark
an order `PAID` — a client claiming success on its own is never sufficient.

`confirm_and_assign_order()` runs after `PAID`: transitions to `CONFIRMED`
(there's no restaurant POS integration to make that a real separate human
step yet), then looks up the sole active courier (V1 has exactly one — the
founder) and transitions to `COURIER_ASSIGNED` if one exists. If no courier
row exists yet (founder hasn't been promoted per the README), it stops at
`CONFIRMED` rather than failing the payment webhook over it.

**Not built:** live order tracking (Phase 6) — the customer-facing order
screen is point-in-time, not realtime-subscribed. Refund execution (Stripe
refund API call) — `REFUND_PENDING`/`REFUNDED` are real reachable states,
but nothing currently calls Stripe to actually issue one.

## Courier dashboard

Lives in `mobile/`, not a separate app — the courier is just another
`profiles` row with `role = 'courier'`, and the same Expo app routes them
to a `(courier)` group instead of the customer `(tabs)` group on sign-in
(`app/index.tsx`, `(auth)/_layout.tsx`, `(tabs)/_layout.tsx` all check
`profile.role`). One account is one role at a time — there's no in-app role
switcher; testing both sides needs two accounts. This was a deliberate
reuse decision: the courier already has an authenticated Supabase session
via the exact same auth system, so a second app would only duplicate that
plumbing for no benefit at V1's scale (one courier).

`app/(courier)/index.tsx` queries `orders` for everything assigned to that
courier in an in-flight status (`COURIER_ASSIGNED` through `ARRIVED` —
excludes `DELIVERED`/`CANCELLED`/`REFUND_PENDING`/`REFUNDED`/`DISPUTED`,
which are either done or admin-only from here per
`transition_order_status()`'s authorization table). Each order's single
next-action button calls `transition_order_status()` directly with the
courier's own session — no separate approval layer, the DB function is
already the authority.

This needed one RLS fix (`0007_courier_customer_visibility.sql`): the
original `profiles` policy only let someone read their own row or an admin
read any row, so a courier had no path to a customer's name/phone at all,
even for an order assigned to them. Fixed with a policy scoped to exactly
that relationship — a courier can read a customer's profile only if an
order links them, never a blanket grant.

**Deliberately not shown:** "delivery hours worked" and revenue-per-hour.
Both need real time tracking (a clock-in/out concept, or similar) that
doesn't exist in the schema — approximating it from order timestamps would
produce a misleading number, and the real version of this metric is
explicitly Phase 8 analytics work, not this operational screen. Also not
built: realtime updates (pull-to-refresh only; Phase 6), and maps/distance/
ETA on each order card (no Maps API configured — per brief section 36, not
faking an integration that isn't there).

## Menu sync

**Goal:** menus stay accurate with zero manual data entry after initial
setup, without ever risking a bad parse silently costing real margin.

### Sources

Allowed: Google Places API, a restaurant's own website (HTML or PDF menu),
and Toast/Square/Clover/ChowNow online-ordering pages (structured JSON
payloads or documented partner APIs).

Never: DoorDash/Uber Eats/Grubhub/Postmates/Yelp menu data, any source
whose ToS prohibits automated access, or any form of bot-detection evasion
(header spoofing, proxy rotation, CAPTCHA solving, browser fingerprint
masking). If a target site blocks automated access, that's logged and
surfaced for manual handling — never worked around.

**As verified 2026-08-13, before any adapter code was written** (rather
than assumed): `order.toasttab.com` sits behind a Cloudflare managed
challenge (403 + JS interstitial, even for `robots.txt`).
`clover.com/online-ordering` and `eat.chownow.com` both serve an empty
client-rendered SPA shell — no server-side menu data in the initial fetch,
it loads afterward via each platform's internal (undocumented) API once
their JS runs. `square.site` does embed server-side JSON
(`window.__BOOTSTRAP_STATE__`), but it's Square's own internal
site-builder state, not a documented menu format.

None of the four are plainly scrapable today without either (a) executing
their JS with a real browser to reach an undocumented internal endpoint —
which starts edging toward the fingerprinting/evasion this project
explicitly avoids — or (b) integrating each platform's actual OAuth
partner/developer API, which needs per-restaurant credential storage this
schema doesn't have yet (a real, separate decision, not made here).
`toast.ts`/`square.ts`/`clover.ts`/`chownow.ts` reflect this honestly:
each fetches, then throws a clear error naming what was verified and what
the real integration path would be, rather than faking a schema. In
practice `detect.ts` only routes those four exact hostnames to them, so
`generic.ts` (Claude vision, extracting from whatever HTML or PDF a
restaurant's own site actually has) is what runs for Point Loma Eats' real
target restaurants — small independent places, not enterprise POS ordering
pages.

### Pipeline

```
1. Places lookup           -> website URL, hours, phone, coords          (places.ts)
2. Fetch site               respects robots.txt, honest User-Agent,      (fetch.ts)
                             >=1 req/sec/domain, throws FetchBlockedError
                             on a bot-challenge response — never retried
                             past
3. Platform detection      -> toast | square | clover | chownow | generic (detect.ts)
4. Adapter                 -> AdapterResult (adapter-native shape)        (adapters/*.ts)
5. Normalize                validates + canonicalizes -> NormalizedMenu   (normalize.ts)
                             prices, drops unparseable items rather than
                             guessing, discounts run confidence by drop rate
6. Diff                    -> ProposedChange[] vs current menu_items      (diff.ts)
                             (price / availability / new / delete)
7. Apply                    auto_applied vs pending_review per rules      (apply.ts)
                             below; writes base_price only, never
                             display_price (that stays trigger-derived)
8. Log                     -> menu_sync_runs + menu_item_changes rows     (index.ts)
```

`index.ts` orchestrates this per restaurant and never throws — every
outcome (`success` / `partial` / `failed` / `blocked`) is recorded as a
`menu_sync_runs` row instead, so one restaurant's failure can't take down
the nightly batch. 3 consecutive `failed`/`blocked` runs for a restaurant
sets `sync_status = 'needs_attention'` and stops retrying it.

### Auto-apply rules

We display marked-up prices and are committed to them at checkout, so a
bad parse costs real margin:

| Change | Outcome |
|---|---|
| Price decrease (any size) | auto-applied |
| Price increase ≤ 5% | auto-applied |
| New item | auto-applied |
| Availability change | auto-applied |
| Price increase > 5% | queued for review |
| Item deletion | queued for review |
| Category restructuring | queues the entire run |
| Run confidence < 0.85 | queues the entire run |
| > 30% of items changed | queues the entire run |

The three run-level conditions override every individual change's own
rule — a parse that's mostly wrong can still contain individually
plausible-looking price decreases, so a low-confidence or high-churn run
gets queued wholesale rather than cherry-picked.

`manual_override = true` on a `menu_items` row means sync never touches
it, enforced at both the read layer (excluded from the diff entirely in
`index.ts`, so the rest of the pipeline never sees it) and the write layer
(`apply.ts` re-guards with `.eq('manual_override', false)` on every
update).

### Scheduling

Nightly via Supabase `pg_cron` + `pg_net` (`0005_menu_sync_cron.sql`),
POSTing to `services/menu-sync/http-server.ts`'s `/trigger` endpoint —
`pg_cron` only speaks SQL, it can't invoke a Node process directly.
Sequential, not parallel; skips `sync_enabled = false`. The service's
actual deployment target (where that HTTP endpoint lives) isn't decided
yet — the trigger URL is an unset placeholder until it is.

### Known gaps

Toast/Square/Clover/ChowNow adapters don't parse real data yet (see
above) — they need either a confirmed page structure or, more likely, an
OAuth partner API integration with per-restaurant credential storage,
which is a real architectural addition (encrypted secret storage, token
refresh) not built here. `generic.ts`'s Claude API cost per restaurant per
nightly run isn't sized or budgeted. Admin approve/reject currently
soft-deletes (`is_available = false`) rather than hard-deleting on an
approved `delete` change, so it's reversible — there's no hard-delete path
from the admin UI yet.
