-- Phase 8: analytics. Only one schema change — everything else (most
-- popular restaurant/delivery point, peak ordering hour, orders/revenue
-- over a date range) is computable from existing tables, aggregated in the
-- admin app the same way the Dashboard already does.

-- The real Stripe processing fee per payment, so "contribution margin" can
-- net out an actual cost (brief section 7 explicitly lists "payment
-- processing cost") instead of silently ignoring it. Populated by
-- stripe-webhook after an extra Stripe API call — not derivable from
-- anything already stored (Stripe doesn't include the fee on the
-- PaymentIntent object itself, only on the underlying charge's balance
-- transaction).
alter table payments add column processing_fee numeric check (processing_fee is null or processing_fee >= 0);
