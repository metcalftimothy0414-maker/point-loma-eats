# Security

The consolidated security reference for this repo — what the model is,
where the boundaries actually live in code, and what's a known, accepted
gap versus an open problem. `ARCHITECTURE.md` covers how the system works;
this covers how it's protected. `supabase/tests/` is what actually enforces
most of the guarantees described here — see its README for what's covered
and what isn't.

## Model, in one paragraph

Row Level Security denies by default on every table. An `is_admin()`
helper (checks `profiles.role = 'admin'`, `SECURITY DEFINER` so it doesn't
recurse into its own check) gates admin-level RLS policies. Nothing on the
client — not the mobile app, not a JWT claim, not a request body field —
is ever trusted to state its own privilege level, order status, or
payment status; every one of those is decided server-side, either by an
RLS policy or by a `SECURITY DEFINER` function that re-validates
regardless of who's calling.

## Authentication

- **Customer and courier** (`mobile/`): Supabase Auth. One account, one
  role (`profiles.role`) at a time — there's no in-app role switcher. A
  courier account can't browse/order as a customer and vice versa; see
  the root README for how role changes are made (SQL only, not
  client-settable — see Authorization below).
- **Admin** (`admin/`): HTTP Basic Auth with a single shared founder
  credential (`admin/proxy.ts`), not per-user Supabase Auth sessions. This
  is a deliberate shortcut for an app with exactly one real user, not an
  oversight — see `ARCHITECTURE.md`'s Admin Dashboard section for the
  reasoning. Concrete cost of the shortcut: there's no per-admin identity,
  so `support_tickets.resolved_by` is always null and nothing distinguishes
  which admin took which action anywhere in the system. Revisit if a
  second admin ever becomes real.
- **Edge Functions**, per function, deliberately not uniform:
  - `create-payment-intent` — the caller's own Supabase JWT, forwarded
    through so `create_order()`'s `auth.uid()` resolves to them. Checkout
    can only ever create an order for the signed-in caller.
  - `stripe-webhook` — Stripe's own signature (`constructEventAsync`, the
    Web-Crypto variant Deno needs since it has no Node-style synchronous
    crypto). Nothing about the request body is trusted until this passes.
  - `refund-payment`, `send-order-notification`, and
    `services/menu-sync/http-server.ts` — a shared secret
    (`ADMIN_ACTION_SECRET`, `NOTIFICATION_TRIGGER_SECRET`,
    `MENU_SYNC_TRIGGER_SECRET`), since these are called by a Postgres
    trigger via `pg_net` or by `admin/`'s own server actions, never
    directly by a customer/courier client — no user-facing signature
    scheme is needed. See **Incident: fail-open shared-secret checks**
    below for why this needed a specific fix, not just "a secret exists."

## Authorization

- **Row-level isolation.** A customer sees only their own orders/order
  items/status history/payments/support tickets. A courier sees only
  orders assigned to them. Verified directly in
  `supabase/tests/02_customer_isolation.sql` and
  `03_state_machine_and_courier.sql` — including the specific case of a
  courier who *knows* an order's id (not just can't find it) still being
  rejected by `transition_order_status()`'s own authorization, independent
  of RLS row-visibility.
- **Role protection.** `profiles.role` cannot be changed by the row's own
  owner — `profiles_update_own_or_admin`'s `WITH CHECK` clause requires
  `role = current_user_role()` (the value already on the row) unless
  `is_admin()`. See **Incident: profile-update RLS recursion** below for a
  real bug this exact mechanism had, found and fixed in Phase 9.
- **Order state machine.** `transition_order_status()` is the only path
  that ever changes `orders.status`. Every call is checked against a fixed
  transition graph (`is_valid_order_transition`) *and* against who's
  allowed to make that specific transition:

  | Transition target | Who |
  |---|---|
  | `CANCELLED` | the order's own customer, or admin |
  | `COURIER_ACCEPTED` … `DELIVERED` | the order's assigned courier, or admin |
  | everything else (`PAYMENT_PENDING`, `PAID`, `CONFIRMED`, `COURIER_ASSIGNED`, `REFUND_PENDING`, `REFUNDED`, `DISPUTED`) | admin or `service_role` only |

  That last row is what makes the Stripe webhook the only thing that can
  ever mark an order `PAID` — a client claiming success on its own is
  never sufficient, and a courier can't self-issue a refund by calling the
  function directly (tested explicitly).
- **`service_role` usage.** Bypasses RLS entirely (Postgres `BYPASSRLS`
  attribute, not something PostgREST fakes at the API layer) and is used
  by: `admin/` (every page, via `lib/supabase-admin.ts`), `stripe-webhook`,
  `send-order-notification`, `refund-payment`, and `services/menu-sync`.
  Calling `transition_order_status()` with a `service_role` connection
  satisfies its "admin or service role" check the same way an
  `is_admin()`-true JWT does — intentional, not a bypass introduced later.

## Sensitive data: margin protection

`menu_items.base_price`, `orders.food_cost`/`gross_margin`, and the entire
`pricing_settings` table (`markup_pct`, `on_demand_markup_pct`,
`minimum_subtotal`) are locked down from `anon`/`authenticated` via
column-level `REVOKE`/`GRANT` (not just RLS) — a customer who can see
`display_price` must not be able to back out what the restaurant actually
charges by comparing it to `base_price`, or infer the markup rate directly.
`current_pricing_settings()` additionally has `EXECUTE` revoked from
`PUBLIC` — Postgres grants that automatically on `CREATE FUNCTION`, and
leaving it in place would have let any signed-in client call the function
directly via RPC and read `markup_pct` straight past the table-level lock
(found and fixed same-phase, in `0003_pricing_catalog_orders.sql` itself,
before anything was deployed).

Note the one real limit of this mechanism, documented where it surfaced
(`ARCHITECTURE.md`, Admin Dashboard section): column-level privileges
apply to a Postgres *role*, not to `profiles.role`. Every signed-in user
shares the `authenticated` Postgres role, so `is_admin()` grants row-level
access to everything but does **not** grant column-level access to
`food_cost` etc. — only `service_role` does. Since `admin/`'s real access
exclusively goes through `service_role`, this isn't a gap in practice, but
it means an admin connecting with their own JWT (not through `admin/`)
would be column-blocked exactly like a customer.

## Payments

Stripe. No card data is ever stored — Stripe's PaymentSheet SDK handles
collection entirely client-side; this app only ever sees a `client_secret`
and a `payment_intent_id`. `payments` mirrors Stripe's own PaymentIntent
status strings verbatim rather than reinterpreting them.
`payments.refunded_amount`/`processing_fee` are populated by real Stripe
API responses (a refund call, and a `balance_transaction` fee lookup), not
computed or estimated locally. Refunds are admin-only
(`refund-payment`), and Stripe's own API is the guard against
double-refunding or refunding more than was charged — not re-validated in
this codebase.

## Incident: fail-open shared-secret checks

Found during a Phase 9 security pass, not reported by anything external.
`refund-payment`, `send-order-notification`, and
`services/menu-sync/http-server.ts` all used the same pattern:

```ts
if (secret && header !== secret) { /* deny */ }
```

When the secret env var is unset, that condition is `false` for *every*
request — the deny branch never fires. Concretely: an operator who forgot
to set `ADMIN_ACTION_SECRET` before deploying would have shipped a public,
unauthenticated endpoint capable of issuing a real Stripe refund against
any order. Not a hypothetical — that is exactly what the code did.

Fixed to fail closed (`!secret || header !== secret` — deny when no secret
is configured, not only when the header is wrong) in all three, with the
check pulled into a small, directly tested function in each rather than
left as an inline conditional: `supabase/functions/_shared/auth.ts`
(`isAuthorized`, shared by the two Deno functions, 3 tests) and a
duplicated equivalent in `services/menu-sync/http-server.ts` (separate
Node deployable, not sharing a module with the Deno functions; 4 tests,
including the case where a repeated HTTP header arrives as an array and
must never accidentally match).

## Incident: profile-update RLS recursion

Found while writing `supabase/tests/` (Phase 9), not by any code path the
app actually exercises — the mobile app has never implemented profile
editing. `profiles_update_own_or_admin`'s `WITH CHECK` clause had a raw
subquery, `role = (select role from profiles where id = auth.uid())`,
directly against the same table the policy is defined on. Unlike
`is_admin()` (`SECURITY DEFINER`, so its internal query runs as the
function owner and isn't RLS-filtered), this raw subquery ran as the
calling role and *was* subject to `profiles`' own RLS — meaning
evaluating it required re-evaluating `profiles`' policies, which required
evaluating the same subquery again: `ERROR: infinite recursion detected
in policy for relation "profiles"`. This broke **any** update to your own
profile row, not just a role-escalation attempt, and had been live since
Phase 1.

Fixed in `0011_fix_profile_update_recursion.sql`: a new
`current_user_role()` `SECURITY DEFINER` function, matching the pattern
`is_admin()` already used correctly, wrapping the self-reference so it no
longer triggers recursive RLS evaluation. Verified by the same test that
found it (`supabase/tests/05_admin_and_role_protection.sql`), which now
passes.

## Known limitations — accepted, not overlooked

- **No fraud/abuse detection.** Brief section 23 (repeated failed
  payments, excessive refunds, duplicate accounts, etc.) is not built.
  Nothing currently flags suspicious activity for admin review.
- **No rate limiting** on any Edge Function or the admin app.
- **No military/CAC verification**, deliberately, per the brief's own
  policy instruction (section 4): this app does not attempt to verify
  installation access, store CAC data, or represent any government
  authorization. Access control here is entirely about *this app's* data,
  not installation security.
- **`admin/`'s single shared credential** (see Authentication above) means
  no audit trail of which admin did what — every admin action is
  attributed to "the admin app," not a person.
- **The four POS-platform adapters** (`toast.ts`/`square.ts`/`clover.ts`/
  `chownow.ts` in `services/menu-sync/`) are intentionally non-functional
  — verified against real pages that plain fetching is blocked (Cloudflare
  wall, empty SPA shells) or hits undocumented internal state. This is a
  scope decision, not a security gap: the alternative would be either
  browser-automation evasion (explicitly out of bounds) or an OAuth
  integration requiring new encrypted credential storage (not built,
  explicitly deferred). See `ARCHITECTURE.md`'s Menu sync section.
- **No EAS project configured**, so push notification tokens can't
  actually be fetched (`mobile/lib/notifications.ts` fails gracefully
  rather than blocking the app). This has a security-adjacent
  consequence worth naming: a courier's "new order" push notification
  doesn't currently reach a real device, so in-app/pull-to-refresh
  visibility is the only signal until a development build exists.

## Secrets

Never committed. `.env.example` files in `mobile/`, `admin/`, and
`services/menu-sync/`'s README document what's required; real values live
in `supabase secrets set`, each app's `.env.local`, or the deployment
platform's own secret store. `SUPABASE_URL`/`SUPABASE_ANON_KEY`/
`SUPABASE_SERVICE_ROLE_KEY` are injected automatically into Edge Functions
by Supabase — never set those explicitly.

## Testing

`supabase/tests/` is a real, re-runnable regression suite covering most of
what's described above end to end (see its own README for exact
coverage and the two things it can't reach — Stripe/Expo API calls, which
need the Deno/Node runtime and real or mocked external services instead).
Run it after any change to RLS policies, the order state machine, or
`create_order()`: `supabase/tests/run.sh`.
