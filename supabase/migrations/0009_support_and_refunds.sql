-- Phase 7: admin dashboard support tables.
-- Everything else the admin app manages (orders, restaurants, menus,
-- installations, pricing, payments) already has a table from earlier
-- phases — this migration only adds what's genuinely new: refund tracking
-- and support tickets.

-- payments.status mirrors Stripe's own PaymentIntent status strings
-- (documented in 0006) — "refunded" isn't a real PI status, so tracking a
-- refund gets its own column rather than overloading that invariant.
alter table payments add column refunded_amount numeric check (refunded_amount is null or refunded_amount >= 0);

create type support_ticket_category as enum (
  'MISSING_ITEM', 'WRONG_ITEM', 'FOOD_DAMAGED', 'LATE_DELIVERY',
  'ORDER_NEVER_ARRIVED', 'PAYMENT_PROBLEM', 'OTHER'
);
create type support_ticket_status as enum ('OPEN', 'RESOLVED');

create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  customer_id uuid not null references customers (id),
  category support_ticket_category not null,
  description text,
  status support_ticket_status not null default 'OPEN',
  resolution_notes text,
  resolved_by uuid references profiles (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index support_tickets_order_id_idx on support_tickets (order_id);
create index support_tickets_status_idx on support_tickets (status) where status = 'OPEN';

alter table support_tickets enable row level security;

-- Read-only for the customer (their own tickets) — there's no
-- customer-facing "report a problem" flow built yet (that's mobile-app
-- work, not part of the admin dashboard), so there's no client insert
-- policy either. For now every ticket is logged by admin on a customer's
-- behalf (phone/text), via the service role.
create policy "support_tickets_select_own_or_admin" on support_tickets
  for select using (customer_id = auth.uid() or is_admin());
