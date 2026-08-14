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
  would otherwise throw on a replayed event).

## Deploy

```
supabase functions deploy create-payment-intent stripe-webhook
supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_...
```

`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — don't set those yourself.

Point a Stripe webhook (Dashboard → Developers → Webhooks) at the deployed
`stripe-webhook` function URL, subscribed to `payment_intent.succeeded` and
`payment_intent.payment_failed`.

## Local dev

`deno check <file>` works without any Supabase/Stripe credentials (verified
against real Stripe v22 types). Running these for real needs
`supabase functions serve` plus a `.env` with the vars above — not set up
here, since there's no Supabase project linked yet.
