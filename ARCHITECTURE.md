# Architecture

## Structure

```
mobile/                 Expo (React Native + TypeScript) customer + courier app, expo-router
admin/                  Next.js admin app — Dashboard/Analytics/Orders/Restaurants/
                         Customers/Installations/Pricing/Payments/Refunds/Support/Menu Sync
supabase/migrations/    SQL migrations, applied in order, single source of truth for the schema
supabase/functions/     Deno Edge Functions — checkout, webhook, notifications, refunds
services/menu-sync/     Automated menu ingestion pipeline (Node, standalone deployable)
```

Backend is Supabase end to end — Postgres + Auth + RLS + Realtime, plus Edge
Functions for the things Postgres genuinely can't do itself: calling Stripe,
verifying Stripe's webhook signature, and sending push notifications. No
separate API server for the customer/courier apps. `admin/` talks to
Postgres directly via the service role key (see its own section below) —
it's the one app in this repo that doesn't go through RLS at all.
`services/menu-sync` is the one piece of backend logic that lives fully
outside Supabase, because it needs to make outbound HTTP calls (restaurant
sites, Google Places, the Claude API) on a nightly schedule, not in response
to a request.

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

Refund execution (an actual Stripe refund API call) was built in Phase 7 —
see the Admin Dashboard section's "Orders and Refunds" below for
`refund-payment`.

## Live tracking & notifications

**Goal:** the customer's order screen reflects reality without a manual
refresh, and both the customer and courier get pushed the handful of
status changes that actually matter to them — without needing every place
that can change an order's status to remember to also send a notification.

### Live tracking

`orders` is added to the `supabase_realtime` publication
(`0008_live_tracking_notifications.sql` — tables aren't broadcast by
default). The customer's order screen (`mobile/app/order/[id].tsx`)
subscribes to `UPDATE` events on its own order id and patches just the
`status` field into local state; everything else on the order (items,
totals, restaurant/delivery point) is fetched once and doesn't change
after checkout. RLS already scopes this correctly — the existing
`orders_select_own_customer_or_courier_or_admin` policy applies to
Realtime subscriptions the same way it applies to a normal query, so no
new policy was needed for this part.

The courier dashboard is deliberately *not* realtime-subscribed — it's
pull-to-refresh plus the "New order" push notification below, which
covers the actual need (knowing promptly that something needs attention)
without adding a second live-subscription surface for what the brief only
called out as customer-facing tracking.

### Notifications

One trigger, not scattered notify-calls: `order_status_history_notify`
(`0008_live_tracking_notifications.sql`) fires on *every* insert into
`order_status_history`, regardless of which of the several paths wrote it
(the Stripe webhook, a courier's own RPC call from the dashboard, an admin
action) — via `pg_net`, calling the `send-order-notification` Edge
Function. That function is the single place that decides which statuses
are actually notify-worthy (`selectNotifications()`, matching the brief's
customer/courier notification lists in section 20, plus `CANCELLED` added
to the customer list — leaving a customer with no word their order was
cancelled seemed worse than the brief's list not being exhaustive there).
Deciding this in exactly one place matters: a second filter at the
trigger level could quietly drift out of agreement with the function's
own mapping over time.

Push delivery itself is Expo's push service (`exp.host/--/api/v2/push/send`),
using whichever `profiles.expo_push_token` applies —
`mobile/lib/notifications.ts` registers one per account (not per device;
V1 doesn't need multi-device push) after sign-in, regardless of role, since
both customers and couriers can receive pushes.

**Real limitation, not glossed over:** this repo has no EAS project
configured (`app.json` has no `extra.eas.projectId`), and Expo Go no
longer supports remote push (removed in SDK 53+) — so
`getExpoPushTokenAsync` has nothing to call and returns null in the
current setup. `registerForPushNotificationsAsync()` handles that
gracefully (logs and returns null, never throws — the rest of the app
works regardless), but actually receiving a push needs `eas init` and a
development build, neither of which is done here.

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

## Admin dashboard

**Scope decision, stated up front:** the brief lists 14 admin sections.
Built for real: Dashboard, Analytics, Orders, Restaurants, Customers,
Installations, Pricing, Payments, Refunds, Support, Menu Sync. Dropped:
Incidents/Settings (the brief never actually defines what either would
contain beyond what Support and env vars already cover — a placeholder page
with nothing real in it seemed worse than an honest omission).

### Access model

Every page uses `lib/supabase-admin.ts` — a service-role Supabase client
that bypasses RLS entirely — gated by `proxy.ts`'s HTTP Basic Auth with a
single shared founder credential. This is a deliberate shortcut, not an
oversight: building real per-admin authentication (Supabase Auth sessions,
`is_admin()`-checked RLS instead of a full bypass) for an app with exactly
one real user would be pure unused infrastructure. The concrete cost of
that shortcut: support ticket resolutions have no `resolved_by`, since
there's no per-admin identity to attribute one to. Revisit both the auth
model and that gap together, if a second admin ever becomes real.

### Restaurants, menus, installations, pricing — closing a real gap

Before this phase, restaurants, menu items, installations, delivery zones/
points, and pricing could only be created or changed via direct SQL — every
example in this repo's own migration tests was seeded that way. That's not
a viable operating model past initial local testing. These four sections
are straightforward CRUD (Server Components for reads, Server Actions for
writes, following the pattern the Menu Sync section already established),
but they're not busywork: they're the actual mechanism the founder would
use to run the business day to day. Two things worth calling out
specifically:

- Menu item edits only ever write `base_price` — `display_price` stays
  derived by the trigger from 0003, the same invariant every other write
  path in this repo (checkout, menu-sync's `apply.ts`) already respects.
- Pricing changes insert a new `pricing_settings` row rather than editing
  the current one in place, matching its `effective_from`-versioned design
  — editing in place would silently rewrite what rate was "in effect" for
  past orders, which the schema specifically exists to prevent.

The Pricing page queries the `pricing_settings` table directly rather than
calling `current_pricing_settings()` via RPC — that function had `EXECUTE`
revoked from `PUBLIC` (0003, to stop `anon`/`authenticated` reading markup
off it) and is owned by whoever ran the migration, not `service_role`;
rather than assume `service_role` still has `EXECUTE` on it specifically,
querying the table directly sidesteps the question — `service_role`'s
`BYPASSRLS` plus its ordinary table-level grants (the same mechanism every
other admin page already relies on) cover it without ambiguity.

### Orders and Refunds

The order detail page can set any status directly and can see
`food_cost`/`gross_margin` (both hidden from the customer/courier apps via
column-level grants, but visible here since `service_role` was never
revoked from) — `transition_order_status()`'s fixed graph is still
enforced underneath; an admin attempting an invalid transition gets an
error, not a silent no-op or a bypass of the state machine itself. Calling
that function from this app's service-role client satisfies its
`v_is_service_role` check the same way the Stripe webhook already does —
an intentional, previously-documented part of the state machine, not a new
bypass introduced here.

Refunds closes a gap flagged since Phase 4: `REFUND_PENDING`/`REFUNDED`
were reachable states with nothing that actually called Stripe. The
`refund-payment` Edge Function (admin-only, shared-secret gated) does that
for real — see its own section under Edge Functions below.

### Dashboard metrics — what's real, what's deferred

Average delivery time is computed from actual `order_status_history`
timestamps (`COURIER_ACCEPTED` → `DELIVERED`), not estimated. Orders/hour
and revenue/hour use wall-clock hours since midnight — a genuinely
different, honestly-computable metric from what the courier dashboard
deliberately omits ("hours worked," which would need real clock-in/out
data that doesn't exist). Repeat-customer rate is lifetime, not scoped to
today. Deeper, range-scoped analytics are a separate page — see below.

### Analytics

Same computation patterns as the Dashboard (aggregate raw rows in the
Server Component, no new SQL views), but over a `?from=&to=` date range
instead of hardcoded to today, and with the metrics that only make sense
across a range:

- **Most popular restaurant / delivery point** — order count and (for
  restaurants) delivered revenue, grouped in JS over the range's orders.
- **Peak ordering hour** — bucketed in `America/Los_Angeles` explicitly
  (`Intl.DateTimeFormat` with an explicit `timeZone`), not the server's own
  timezone, which a Next.js deployment can't be assumed to share with Point
  Loma. Verified directly against known UTC↔Pacific conversions across both
  a PDT and a PST case, plus the specific edge case where midnight in
  Pacific time formats as hour "24" rather than "0" and has to be
  normalized — this is the one part of the page with real date-math
  subtlety, so it's the one part checked in isolation rather than only via
  a rendered-page smoke test.
- **Orders/day and revenue/day** (average over the range) — deliberately
  *not* "orders/hour" the way the Dashboard shows it; diluting a multi-day
  range down to an hourly rate produces a confusingly small, less legible
  number than a daily average does. The Dashboard's hourly framing is
  specifically about "how's today going so far," which doesn't carry over
  to a 30-day view.
- **Contribution margin** — gross margin (`revenue − food_cost`, same as
  the existing `orders.gross_margin` column) minus the real Stripe
  processing fee, now that `stripe-webhook` captures it (see Edge
  Functions below). The page shows how many of the range's delivered
  orders actually have a captured fee, so a partial/stale figure is
  visible as such rather than presented as complete.
- **Customer acquisition cost — not shown.** Nothing in this system tracks
  marketing or ad spend, so there's no real number to divide by new
  customers. The page says this plainly rather than omitting it silently
  or inventing a placeholder.
- **Vehicle/gas cost — not netted into contribution margin**, for the same
  reason: no real input for it exists anywhere in the schema, and
  approximating one would make the headline number look more complete than
  the underlying data actually supports.

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

## Testing & security

**Goal:** the highest-risk parts of this system (RLS, the order state
machine, checkout atomicity, admin permissions) get a real, persistent,
re-runnable regression suite — not just the ad-hoc "spin up local Postgres,
check something, tear it down" verification every earlier phase used while
building, which caught real bugs in the moment but left nothing behind.

### SQL test suite

`supabase/tests/` — `run.sh` applies every migration (except `0005`, which
needs real `pg_cron`/`pg_net`) to a throwaway local Postgres and runs five
numbered test files covering exactly the brief's section 31 list: customer
isolation, courier isolation, order state transitions and their
authorization boundaries, checkout atomicity and pricing math, and admin
permissions (including the row-level-vs-column-level nuance between
`is_admin()`-via-JWT and `service_role` — see the file itself). Full
details, including two real psql gotchas the test files had to work around
(cross-file variable scope, and `:'var'` substitution not reaching inside
`do $$ ... $$` blocks), are in `supabase/tests/README.md`.

**What it actually found, not just re-confirmed:** `profiles_update_own_or_admin`'s
`WITH CHECK` clause had a raw self-referential subquery against `profiles`
— a known Postgres RLS recursion trap, not wrapped in a `SECURITY DEFINER`
function the way `is_admin()` correctly is. This broke *any* update to
your own profile row, not just a role-escalation attempt — genuinely
broken since Phase 1, undiscovered until now because the mobile app has
never implemented profile editing. Fixed in
`0011_fix_profile_update_recursion.sql`.

### The other real security fix this phase

Three internal-only endpoints — `refund-payment`, `send-order-notification`,
and `services/menu-sync`'s HTTP trigger — used `if (secret && header !== secret)`
to gate access. When the secret env var is unset, that condition is false
for *every* request, so the unauthorized branch never fires: an operator
who forgot to configure `ADMIN_ACTION_SECRET` would have deployed a public,
unauthenticated endpoint that can issue a real Stripe refund against any
order. Not hypothetical — that's exactly what the code did. Fixed to fail
closed (`!secret || header !== secret`) in all three, with the check
extracted into a small tested function in each (`supabase/functions/_shared/auth.ts`,
shared by the two Deno functions; a duplicated equivalent in
`services/menu-sync/http-server.ts`, since that's a separate Node
deployable).

### Not covered by the SQL suite

Anything requiring Stripe or Expo push — those need the Deno/Node runtimes
and real (or mocked) external APIs. `stripe-webhook`, `create-payment-intent`,
and `refund-payment`'s actual Stripe calls are typechecked (`deno check`
against real Stripe v22 types throughout this project) but not
integration-tested end to end; that would need either a live Stripe test
account or a mocking layer, neither set up here.
