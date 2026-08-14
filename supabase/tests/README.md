# SQL tests

A real, persistent regression suite for the schema — formalizing what had
been ad-hoc, throwaway local-Postgres verification throughout every earlier
phase of this project into something that stays around and can be re-run.
Maps directly to the brief's section 31 test list (customer isolation,
courier isolation, order state transitions, admin permissions, pricing).

## Run

```
supabase/tests/run.sh
```

From the repo root. Needs a local Postgres (`brew install postgresql`) —
spins up a throwaway instance in a temp directory, applies every migration,
runs the numbered test files in order, tears down. Exits non-zero on any
failure.

`0005_menu_sync_cron.sql` is skipped — it does `create extension pg_cron`/
`pg_net` itself, and those aren't installable outside a real Supabase
instance. Every other migration applies for real. `00_stub.sql` stubs the
`auth` schema/roles, the `supabase_realtime` publication, and `net.http_post`
(used by 0008's trigger) — just enough surface for the migrations that
reference them to apply and be exercised, not their actual
scheduling/broadcast behavior.

## Structure

- `00_stub.sql` — environment stubs + `test_assert(condition, message)`,
  which reports `NOTICE: PASS: <message>` or aborts with
  `EXCEPTION: FAIL: <message>`.
- `01_fixtures.sql` — shared users/restaurant/menu items every other file
  depends on. Fixed UUIDs, not `gen_random_uuid()`, so later files can
  reference them directly.
- `02_customer_isolation.sql` — `05_admin_and_role_protection.sql` — one
  file per concern, run in order (each depends on state left behind by
  earlier files, e.g. 03 continues the order 02 created).

Each file is its own `psql` connection/session, deliberately — so
`set role`/`set request.jwt.claim.sub` from one file can never leak into
the next. One consequence: psql's `:'var'` substitution (via `\gset`)
doesn't survive between files, so cross-file references are by name
(`select id from restaurants where name = '...'`) rather than by captured
variable. A second, less obvious consequence within a *single* file:
`:'var'` substitution does not reach inside dollar-quoted `do $$ ... $$`
blocks either (psql treats them as opaque, so it doesn't mangle `::` casts
in real function bodies) — see the comments in `03_state_machine_and_courier.sql`
for the two ways this gets worked around (a plain subquery where the
current role can see the row; a session-local custom GUC set from outside
the block where it explicitly can't, which is what the "unrelated user"
test needs).

## What this caught

Writing this suite — not just re-running old ad-hoc checks — found a real
bug: `profiles_update_own_or_admin`'s `WITH CHECK` clause had a raw
self-referential subquery against `profiles`, not wrapped in a
`SECURITY DEFINER` function the way `is_admin()` correctly is. That's a
known Postgres RLS recursion trap, and it wasn't hypothetical — it broke
*any* update to your own profile row, not just a role-escalation attempt.
Nothing in the app had ever exercised that path (the mobile app has never
implemented profile editing), so it had been silently broken since Phase 1.
Fixed in `0011_fix_profile_update_recursion.sql`.

## Not covered here

Anything that needs Stripe or Expo push, since those require the Deno/Node
runtimes and real (or mocked) external APIs, not plain SQL — see
`supabase/functions/*/index.test.ts` and `services/menu-sync/*.test.ts` for
what's tested there instead. "Payment failure prevents successful
checkout" and "refund correctly updates the order" (brief section 31) are
partially covered: the state-machine authorization these depend on is
tested here, but the actual Stripe API calls in `stripe-webhook`/
`refund-payment` aren't exercised by this suite.
