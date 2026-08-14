# Business logic

The rules of the system — formulas, thresholds, and state definitions —
independent of how they're implemented. `ARCHITECTURE.md` explains the
code; this explains the business decisions the code enforces. Where a rule
here deliberately deviates from the original brief, that's called out
explicitly rather than left for someone to notice later.

## The hypothesis being tested

Per the brief's own framing (section 27): *"Navy barracks residents
without convenient transportation will pay approximately $5–8 plus
optional tip to have popular off-base restaurant food delivered to an
approved delivery point."* Every feature in this system exists to either
run that transaction or measure whether it's working — not to look
impressive. `admin/`'s Dashboard and Analytics pages are the direct
instrumentation for that question.

## Pricing

**This is a deliberate pivot from the brief**, stated plainly: the
original spec described a flat delivery fee ($6.99) + service fee ($1.49)
model. What's actually built is markup-based — the customer pays
`sum(display_price * quantity)` plus an optional tip, with no separate fee
line items. `display_price` already has the restaurant's markup baked in.

- `display_price = round(base_price * (1 + markup_pct), 2)` — maintained
  by a trigger (`menu_items_set_display_price`), never set directly by any
  code path, anywhere, including menu-sync and the admin app.
- `pricing_settings` is versioned by `effective_from`, not edited in
  place — a price change is a new row, so a past order's economics stay
  attached to whatever rate was actually in effect when it was placed.
  Seeded defaults: `markup_pct = 0.45`, `minimum_subtotal = 15.00`,
  `on_demand_markup_pct = 0.55`.
- `on_demand_markup_pct` and `orders.delivery_window_id`/`batch_id` are
  **reserved, unwired columns** — the brief's own future-expansion list
  (section 28) names scheduled orders and courier batching as explicitly
  deferred. The columns exist so the schema doesn't need reshaping later;
  no logic reads or sets them yet.
- A pricing change (a new *current* `pricing_settings` row) reprices every
  menu item's `display_price` immediately. A **future-dated** row is
  stored but does not automatically activate at that future time — there's
  no scheduler; see `ARCHITECTURE.md`'s Menu sync section for the exact
  mechanics and why that's an accepted gap for now.
- **Minimum order enforcement:** `create_order()` rejects any cart whose
  subtotal (sum of `display_price * quantity`, before tip) is below the
  current `minimum_subtotal`. The client never sees this value directly —
  `pricing_settings` has no client-readable RLS policy — so the checkout
  UI shows an estimate and lets the server be the actual source of truth.

## Checkout

`create_order()` is the only path that creates an order, and it is the
authoritative pricing calculation — not the client:

- Every `menu_item_id` in the cart is re-looked-up server-side; the client
  sends quantities, never prices.
- Rejects: an empty cart, a negative tip, an item that's `is_available =
  false`, an item that doesn't belong to the given restaurant, and a
  subtotal below `minimum_subtotal`.
- `food_cost` = sum of `base_price * quantity` — what's owed to the
  restaurant, distinct from `subtotal` (what the customer pays).
- `order_items` snapshots `name`/`unit_price` at order time. Prices can
  change later (a manual edit, a menu-sync run) — an order's economics
  must never silently drift because the menu changed after checkout.
- Fully atomic: any rejection rolls back the entire attempt, including the
  order row itself. There is never a half-created order.

## Order lifecycle

Seventeen states, matching the brief's list exactly:

```
CREATED → PAYMENT_PENDING → PAID → CONFIRMED → COURIER_ASSIGNED →
COURIER_ACCEPTED → AT_RESTAURANT → ORDER_PICKED_UP → EN_ROUTE →
ON_INSTALLATION → APPROACHING → ARRIVED → DELIVERED
```

Plus `CANCELLED`, `REFUND_PENDING`, `REFUNDED`, `DISPUTED`. The full legal
transition graph (every arrow that's actually allowed, including which
states can reach `REFUND_PENDING` — every state from `PAID` onward can, on
the theory that anything can go wrong once money has moved) lives in
`is_valid_order_transition()`, `0006_checkout.sql`. Who is allowed to make
a given transition is a separate check layered on top — see
`SECURITY.md`'s Authorization section for that table; this file is about
what the states *mean*:

- **CREATED** — cart submitted, nothing charged yet.
- **PAYMENT_PENDING** — a Stripe PaymentIntent exists; set by
  `create-payment-intent` right after `create_order()` succeeds.
- **PAID** — set only by `stripe-webhook` on a verified
  `payment_intent.succeeded` event. Never settable by a client, by design.
- **CONFIRMED** — immediately follows `PAID` (`confirm_and_assign_order()`).
  There's no restaurant POS integration to make this a real separate human
  confirmation step, so it's automatic — not a false signal, just an
  acknowledged simplification for a restaurant list this small.
- **COURIER_ASSIGNED** — the sole active courier (V1 has exactly one,
  matching the brief's founder-as-courier model) is looked up and assigned
  automatically. If no courier row exists yet, the order simply stops at
  `CONFIRMED` rather than failing the payment webhook.
- **COURIER_ACCEPTED → ARRIVED** — the courier's own workflow, driven from
  the courier dashboard in `mobile/`, one legal hop at a time.
- **DELIVERED** — the end of the normal happy path.
- **CANCELLED** — reachable by the customer themselves only from
  `CREATED`/`PAYMENT_PENDING`/`CONFIRMED`/`COURIER_ASSIGNED` (before a
  courier has actively started working it); admin can cancel from
  anywhere the graph allows.
- **REFUND_PENDING → REFUNDED** — admin/service-role only. `REFUND_PENDING`
  is a real, distinct intermediate state (not skippable) even when
  `refund-payment` drives both hops in one admin action.
- **DISPUTED** — reachable from `DELIVERED`, admin-only; no automated
  dispute handling exists beyond recording the state.

## Courier model

V1 has exactly one courier: the founder (brief section 1). "Assignment"
is not a dispatch algorithm — it's `select id from couriers where
is_active limit 1`. Multi-courier dispatch is explicitly out of scope
(brief section 28), and nothing in the schema or logic assumes more than
one active courier will ever exist at the same time; the column
(`orders.courier_id`) is there so that assumption can be relaxed later
without a schema change, not because multi-courier logic exists today.

## Refunds

Admin-initiated only (brief section 22 — refunds are an admin decision,
not something a customer or courier can trigger). `refund-payment`:

1. Looks up the order's most recent **succeeded** payment — an order that
   never got past `PAYMENT_PENDING` has none, so there's nothing to
   accidentally "refund."
2. Calls Stripe's real refund API (full or partial amount).
3. Records `payments.refunded_amount` from Stripe's actual response.
4. Drives `REFUND_PENDING → REFUNDED` (via the intermediate hop if the
   order isn't there already).

Stripe's own API is the guard against refunding twice or refunding more
than was charged — not re-validated in this codebase.

## Support tickets

Categories match the brief's list exactly: `MISSING_ITEM`, `WRONG_ITEM`,
`FOOD_DAMAGED`, `LATE_DELIVERY`, `ORDER_NEVER_ARRIVED`, `PAYMENT_PROBLEM`,
`OTHER`. **There is no customer self-service intake yet** — every ticket
today is logged by admin on a customer's behalf (they called or texted).
Resolving a ticket records free-text `resolution_notes` and a timestamp,
not a specific refund/credit action — an admin who decides a ticket
warrants a refund issues it separately via the Refunds page. Account
credit (brief section 22 lists it alongside refunds) is **not built** —
there's no credit-balance concept anywhere in the schema.

## Menu sync auto-apply rules

Exact thresholds, matching the brief's spec (`services/menu-sync/apply.ts`):

| Condition | Outcome |
|---|---|
| Price decrease, any size | auto-applied |
| Price increase ≤ 5% | auto-applied |
| New item | auto-applied |
| Availability change | auto-applied |
| Price increase > 5% | queued for review |
| Item deletion | queued for review |
| Category structure changed | **entire run** queued |
| Run confidence < 0.85 | **entire run** queued |
| > 30% of items changed | **entire run** queued |

The three run-level conditions override every individual change's own
rule — a parse that's mostly wrong can still contain individually
plausible-looking price decreases, so a low-confidence or high-churn run
is queued wholesale rather than cherry-picked. `manual_override = true` on
a `menu_items` row means sync never touches it, checked both where the
diff is computed and again at the point of writing.

## Notifications

Not every status change notifies anyone — most (`PAYMENT_PENDING`,
`COURIER_ACCEPTED`, `AT_RESTAURANT`, `ON_INSTALLATION`, etc.) are
internal-only. What actually sends a push (`send-order-notification`):

| Status | Customer | Courier |
|---|---|---|
| `CONFIRMED` | "Order confirmed" | — |
| `COURIER_ASSIGNED` | — | "New order" |
| `ORDER_PICKED_UP` | "Food picked up" | — |
| `EN_ROUTE` | "Courier on the way" | — |
| `APPROACHING` | "Courier approaching" | — |
| `ARRIVED` | "Courier arrived" | — |
| `DELIVERED` | "Order delivered" | — |
| `REFUNDED` | "Refund issued" | — |
| `CANCELLED` | "Order cancelled" | "Order cancelled" (only if a courier was assigned) |

`CANCELLED` on the customer side is one addition beyond the brief's
section 20 list — leaving a customer with no word that their order was
cancelled seemed worse than the brief's list simply not being exhaustive
there. "Customer changed order" and "support message" (brief's courier
notification list) aren't produced by anything, since neither feature
exists.

## Analytics definitions

Where a metric has real computational nuance, precision matters:

- **Average delivery time** — `COURIER_ACCEPTED` timestamp to `DELIVERED`
  timestamp, from `order_status_history`, averaged across delivered orders
  in the period. Not estimated.
- **Orders/revenue per hour (Dashboard, today only)** — count or revenue
  divided by wall-clock hours elapsed since midnight. This is "how's today
  going so far," not hours anyone worked.
- **Orders/revenue per day (Analytics, date range)** — a different metric
  on purpose: diluting a multi-day range into an hourly rate produces a
  confusingly small number, so Analytics uses a daily average instead of
  extending the Dashboard's hourly framing across the whole range.
- **Peak ordering hour** — bucketed in `America/Los_Angeles` explicitly
  (Point Loma's actual timezone), not whatever timezone a server happens
  to run in.
- **Repeat customer rate** — a customer counts as "repeat" based on their
  *lifetime* order count (> 1), not orders within whatever period is being
  viewed. The Dashboard shows this across all customers ever; Analytics
  scopes the denominator to customers active in the selected range while
  still using lifetime order count for the repeat determination.
- **Contribution margin** — `gross_margin` (`customer_total − food_cost`)
  minus the *real* Stripe processing fee (captured via a second Stripe API
  call in `stripe-webhook`, not estimated). Does **not** net out
  vehicle/gas cost or reflect customer acquisition cost — see
  `ARCHITECTURE.md`'s Analytics section for why those two are shown as
  explicitly absent rather than approximated.
- **"Delivery hours worked"** (courier dashboard) — deliberately **not
  shown anywhere**. It would need real time tracking (clock in/out or
  similar) that doesn't exist; approximating it from order timestamps
  would produce a number that looks more precise than it is.

## Deliberate deviations from the brief, summarized

- Markup-based pricing instead of flat delivery + service fees (above).
- Scheduled orders / delivery windows / courier batching: schema columns
  reserved, no logic — brief's own section 28 defers these.
- Fraud/abuse detection (brief section 23): not built.
- Account credit (brief section 22, alongside refunds): not built.
- Military/CAC verification: **intentionally never built** — this is a
  brief-mandated policy boundary (section 4), not a scope gap.
