# Edge Functions

Deno. See `../../ARCHITECTURE.md` for the checkout flow these are part of.

- `create-payment-intent/` — calls `create_order()` with the caller's own
  JWT (never service role — checkout must only create an order for the
  signed-in user), creates a Stripe PaymentIntent, records it, and moves
  the order to `PAYMENT_PENDING`.
- `stripe-webhook/` — verifies the Stripe signature (`constructEventAsync`,
  the Web-Crypto variant Deno needs), then on `payment_intent.succeeded`
  transitions the order to `PAID` and auto-confirms/assigns it; on
  `payment_intent.payment_failed`, cancels it. Idempotent against Stripe's
  own webhook retries (checks the recorded payment status before
  re-transitioning, since e.g. `PAID -> PAID` isn't a valid transition and
  would otherwise throw on a replayed event). Also captures the real
  Stripe processing fee (`payments.processing_fee`) via a second API call —
  it isn't on the PaymentIntent object itself, only on the underlying
  charge's balance transaction — for analytics' contribution-margin
  calculation. Failure to fetch it is non-fatal; doesn't block the order
  being marked paid.
- `send-order-notification/` — called by the `order_status_history_notify`
  Postgres trigger (`0008_live_tracking_notifications.sql`) via `pg_net` on
  every order status change, not by Stripe or a client. Decides who (if
  anyone) gets a push for a given status via `selectNotifications()` — a
  pure function, tested in `index.test.ts` — then sends via Expo's push API
  using whichever `profiles.expo_push_token` applies. Most calls to this
  function intentionally do nothing (most statuses aren't customer/courier
  notify-worthy).
- `refund-payment/` — admin-only (called from `admin/`'s server actions
  with a shared secret, never by a customer/courier client). Issues a real
  Stripe refund against the order's most recent succeeded payment, records
  `payments.refunded_amount`, and drives the order through
  `REFUND_PENDING -> REFUNDED`. Stripe's own API is the guard against
  double-refunding or refunding more than was charged — not re-validated
  here.

## Deploy

```
supabase functions deploy create-payment-intent stripe-webhook send-order-notification refund-payment
supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_... NOTIFICATION_TRIGGER_SECRET=... ADMIN_ACTION_SECRET=...
```

`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — don't set those yourself.

Point a Stripe webhook (Dashboard → Developers → Webhooks) at the deployed
`stripe-webhook` function URL, subscribed to `payment_intent.succeeded` and
`payment_intent.payment_failed`.

After deploying `send-order-notification`, point the DB trigger at it by
inserting into `app_config` (`0012_trigger_config_table.sql`) — not set by
any migration itself, since the function has no URL until it's deployed.
`alter database ... set app.settings.*` doesn't work on Supabase (blocked
with `permission denied to set parameter` even for the `postgres` role,
confirmed against a real project) — `app_config` (RLS-locked to
`service_role`/`SECURITY DEFINER` functions only, same pattern as
`pricing_settings`) is what `notify_order_status_change()` and
`run_menu_sync_trigger()` actually read:

```sql
insert into app_config (key, value) values
  ('notification_trigger_url', 'https://<project-ref>.supabase.co/functions/v1/send-order-notification'),
  ('notification_trigger_secret', '<same value as NOTIFICATION_TRIGGER_SECRET>');
```

Same table, same pattern, for menu-sync once it has a deployed URL:
`menu_sync_trigger_url` / `menu_sync_trigger_secret`.

## Local dev

`deno check <file>` works without any Supabase/Stripe credentials (verified
against real Stripe v22 types). `deno test --allow-net --allow-env
send-order-notification/index.test.ts` runs the notification-mapping tests
— `--allow-net`/`--allow-env` are needed only because `Deno.serve` runs at
module scope (the Supabase Edge Function convention), not because the
tests themselves touch the network. Running these for real needs
`supabase functions serve` plus a `.env` with the vars above — not set up
here, since there's no Supabase project linked yet.
