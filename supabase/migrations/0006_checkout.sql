-- Phase 4: checkout, the real order state machine, and payments.
-- No delivery/service fee line items in this pricing model (see 0003) —
-- the customer pays sum(display_price * qty) + optional tip. Nothing here
-- builds delivery windows, batching, or courier dashboard UI (Phase 5) —
-- COURIER_ASSIGNED is as far as the automated flow goes; COURIER_ACCEPTED
-- onward needs a human pressing a button that doesn't exist yet.

create type order_status as enum (
  'CREATED', 'PAYMENT_PENDING', 'PAID', 'CONFIRMED',
  'COURIER_ASSIGNED', 'COURIER_ACCEPTED', 'AT_RESTAURANT', 'ORDER_PICKED_UP',
  'EN_ROUTE', 'ON_INSTALLATION', 'APPROACHING', 'ARRIVED', 'DELIVERED',
  'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'DISPUTED'
);

-- orders.status has been plain text (default 'created') since 0003, with
-- no real rows in it yet — safe to convert in place rather than migrate data.
alter table orders alter column status drop default;
alter table orders alter column status type order_status using upper(status)::order_status;
alter table orders alter column status set default 'CREATED';

alter table orders
  add column subtotal numeric not null default 0 check (subtotal >= 0),
  add column tip_amount numeric not null default 0 check (tip_amount >= 0);

-- 0003's column-level GRANT on orders enumerated specific columns; a new
-- column doesn't inherit that automatically, so without this, subtotal and
-- tip_amount (unlike food_cost/gross_margin, not margin-sensitive — this
-- is literally what the customer is being charged) would be invisible to
-- the client that's supposed to see its own order total.
grant select (subtotal, tip_amount) on orders to anon, authenticated;

-- order_items: a price/name SNAPSHOT at order time. menu_items.display_price
-- can change after the order is placed (manual edit, resync) — orders must
-- never re-derive what was charged from current catalog state.
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  menu_item_id uuid references menu_items (id) on delete set null,
  name text not null,
  unit_price numeric not null check (unit_price >= 0),
  quantity int not null check (quantity > 0),
  line_total numeric generated always as (unit_price * quantity) stored
);

create index order_items_order_id_idx on order_items (order_id);

create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  previous_status order_status,
  new_status order_status not null,
  actor_id uuid references profiles (id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index order_status_history_order_id_idx on order_status_history (order_id);

-- Stripe PaymentIntent status strings (requires_payment_method,
-- requires_action, processing, succeeded, canceled, ...), not our own enum —
-- this table exists to mirror what Stripe says, not to reinterpret it.
create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  stripe_payment_intent_id text not null unique,
  amount numeric not null check (amount >= 0),
  currency text not null default 'usd',
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_order_id_idx on payments (order_id);

create trigger payments_set_updated_at
  before update on payments
  for each row execute function set_updated_at();

-- RLS ------------------------------------------------------------------

alter table order_items enable row level security;
alter table order_status_history enable row level security;
alter table payments enable row level security;

create policy "order_items_select_via_order" on order_items
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and (o.customer_id = auth.uid() or o.courier_id = auth.uid() or is_admin())
    )
  );

create policy "order_status_history_select_via_order" on order_status_history
  for select using (
    exists (
      select 1 from orders o
      where o.id = order_status_history.order_id
        and (o.customer_id = auth.uid() or o.courier_id = auth.uid() or is_admin())
    )
  );

-- Payments carry Stripe intent ids/amounts — the courier doesn't need
-- these to do their job, so unlike the two tables above, only the
-- customer (their own) and admin can read them.
create policy "payments_select_own_customer_or_admin" on payments
  for select using (
    exists (
      select 1 from orders o
      where o.id = payments.order_id
        and (o.customer_id = auth.uid() or is_admin())
    )
  );

-- No insert/update/delete policies on any of the three tables above, and
-- none on orders either (0003 already only granted select) — every write
-- goes through create_order()/transition_order_status() below, or the
-- service role from the Stripe webhook. Never a raw client insert/update.

-- Checkout ---------------------------------------------------------------

-- Prices are re-looked-up from menu_items here, server-side, rather than
-- trusted from the client — a client could otherwise submit any price it
-- wants for an order. minimum_subtotal is enforced here for the same
-- reason it's never exposed to the client: it's read from
-- current_pricing_settings(), not passed in.
create function create_order(
  p_restaurant_id uuid,
  p_delivery_point_id uuid,
  p_items jsonb, -- [{"menu_item_id": "...", "quantity": 2}, ...]
  p_tip_amount numeric default 0
) returns table (order_id uuid, subtotal numeric, tip_amount numeric, customer_total numeric) as $$
declare
  v_customer_id uuid := auth.uid();
  v_order_id uuid;
  v_subtotal numeric := 0;
  v_food_cost numeric := 0;
  v_minimum numeric;
  v_item record;
  v_menu_item menu_items%rowtype;
begin
  if v_customer_id is null then
    raise exception 'must be signed in to place an order';
  end if;

  if p_tip_amount is null or p_tip_amount < 0 then
    raise exception 'tip_amount cannot be negative';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'cart is empty';
  end if;

  select minimum_subtotal into v_minimum from current_pricing_settings();

  v_order_id := gen_random_uuid();

  -- Inserted with placeholder totals; updated once every item is priced
  -- below. If anything after this fails, the whole function (and this
  -- insert) rolls back — never a half-created order.
  insert into orders (id, customer_id, restaurant_id, delivery_point_id, status, food_cost, subtotal, tip_amount, customer_total)
  values (v_order_id, v_customer_id, p_restaurant_id, p_delivery_point_id, 'CREATED', 0, 0, p_tip_amount, p_tip_amount);

  for v_item in select * from jsonb_to_recordset(p_items) as x(menu_item_id uuid, quantity int)
  loop
    if v_item.menu_item_id is null or v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'invalid cart item: %', v_item;
    end if;

    select * into v_menu_item from menu_items
      where id = v_item.menu_item_id and restaurant_id = p_restaurant_id and is_available;
    if not found then
      raise exception 'menu item % is not available from restaurant %', v_item.menu_item_id, p_restaurant_id;
    end if;

    insert into order_items (order_id, menu_item_id, name, unit_price, quantity)
    values (v_order_id, v_menu_item.id, v_menu_item.name, v_menu_item.display_price, v_item.quantity);

    v_subtotal := v_subtotal + (v_menu_item.display_price * v_item.quantity);
    v_food_cost := v_food_cost + (v_menu_item.base_price * v_item.quantity);
  end loop;

  if v_minimum is not null and v_subtotal < v_minimum then
    raise exception 'order subtotal % is below the % minimum', v_subtotal, v_minimum;
  end if;

  update orders
  set subtotal = v_subtotal,
      food_cost = v_food_cost,
      customer_total = v_subtotal + p_tip_amount
  where id = v_order_id;

  insert into order_status_history (order_id, previous_status, new_status, actor_id)
  values (v_order_id, null, 'CREATED', v_customer_id);

  return query select v_order_id, v_subtotal, p_tip_amount, v_subtotal + p_tip_amount;
end;
$$ language plpgsql security definer set search_path = public;

-- Order state machine ------------------------------------------------------

-- Static, not admin-editable — this is a fixed workflow, not configuration.
create function is_valid_order_transition(p_from order_status, p_to order_status) returns boolean as $$
  select (p_from, p_to) in (
    ('CREATED', 'PAYMENT_PENDING'),
    ('CREATED', 'CANCELLED'), -- abandoned before paying
    ('PAYMENT_PENDING', 'PAID'),
    ('PAYMENT_PENDING', 'CANCELLED'),
    ('PAID', 'CONFIRMED'),
    ('PAID', 'REFUND_PENDING'),
    ('CONFIRMED', 'COURIER_ASSIGNED'),
    ('CONFIRMED', 'CANCELLED'),
    ('CONFIRMED', 'REFUND_PENDING'),
    ('COURIER_ASSIGNED', 'COURIER_ACCEPTED'),
    ('COURIER_ASSIGNED', 'CANCELLED'),
    ('COURIER_ASSIGNED', 'REFUND_PENDING'),
    ('COURIER_ACCEPTED', 'AT_RESTAURANT'),
    ('COURIER_ACCEPTED', 'REFUND_PENDING'), -- courier accepted but couldn't complete it
    ('AT_RESTAURANT', 'ORDER_PICKED_UP'),
    ('AT_RESTAURANT', 'REFUND_PENDING'), -- e.g. restaurant out of stock/closed on arrival
    ('ORDER_PICKED_UP', 'EN_ROUTE'),
    ('ORDER_PICKED_UP', 'REFUND_PENDING'),
    ('EN_ROUTE', 'ON_INSTALLATION'),
    ('EN_ROUTE', 'REFUND_PENDING'),
    ('ON_INSTALLATION', 'APPROACHING'),
    ('ON_INSTALLATION', 'REFUND_PENDING'),
    ('APPROACHING', 'ARRIVED'),
    ('APPROACHING', 'REFUND_PENDING'),
    ('ARRIVED', 'DELIVERED'),
    ('ARRIVED', 'REFUND_PENDING'), -- e.g. customer never showed up to the delivery point
    ('DELIVERED', 'DISPUTED'),
    ('DELIVERED', 'REFUND_PENDING'),
    ('REFUND_PENDING', 'REFUNDED'),
    ('DISPUTED', 'REFUND_PENDING'),
    ('DISPUTED', 'REFUNDED')
  );
$$ language sql immutable;

-- Every transition, no matter who calls this, is checked against the graph
-- above. Who is ALLOWED to make a given (valid) transition is checked
-- separately below: the customer can only cancel their own order, the
-- assigned courier can only advance their own order through the delivery
-- states, and everything else (PAYMENT_PENDING, PAID, CONFIRMED,
-- COURIER_ASSIGNED, REFUND_PENDING, REFUNDED, DISPUTED) is system/admin
-- only — reachable from the Stripe webhook (via the service role) or an
-- admin, never directly from a customer or courier client.
create function transition_order_status(
  p_order_id uuid,
  p_new_status order_status,
  p_metadata jsonb default '{}'::jsonb
) returns void as $$
declare
  v_order orders%rowtype;
  v_actor uuid := auth.uid();
  v_is_admin boolean := is_admin();
  v_is_service_role boolean := coalesce(current_setting('role', true), '') = 'service_role';
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'order % not found', p_order_id;
  end if;

  if not is_valid_order_transition(v_order.status, p_new_status) then
    raise exception 'invalid transition from % to %', v_order.status, p_new_status;
  end if;

  if not v_is_admin and not v_is_service_role then
    if p_new_status = 'CANCELLED' then
      if v_order.customer_id <> v_actor then
        raise exception 'only the customer or an admin can cancel this order';
      end if;
    elsif p_new_status in (
      'COURIER_ACCEPTED', 'AT_RESTAURANT', 'ORDER_PICKED_UP', 'EN_ROUTE',
      'ON_INSTALLATION', 'APPROACHING', 'ARRIVED', 'DELIVERED'
    ) then
      if v_order.courier_id is distinct from v_actor then
        raise exception 'only the assigned courier or an admin can advance this order';
      end if;
    else
      raise exception 'only an admin or the sync service can set status %', p_new_status;
    end if;
  end if;

  update orders set status = p_new_status, updated_at = now() where id = p_order_id;

  insert into order_status_history (order_id, previous_status, new_status, actor_id, metadata)
  values (p_order_id, v_order.status, p_new_status, v_actor, p_metadata);
end;
$$ language plpgsql security definer set search_path = public;

-- Called by the Stripe webhook (service role) once payment succeeds:
-- PAID -> CONFIRMED -> COURIER_ASSIGNED. There's no restaurant POS
-- integration to make CONFIRMED a real separate step yet, and there's
-- exactly one courier for V1 (see brief section 1) — auto-assigning to
-- them is the whole point of that model. If no courier row exists yet
-- (founder hasn't been promoted per README), the order stops at CONFIRMED
-- rather than failing the payment webhook over it.
create function confirm_and_assign_order(p_order_id uuid) returns void as $$
declare
  v_courier_id uuid;
begin
  perform transition_order_status(p_order_id, 'CONFIRMED');

  select id into v_courier_id from couriers where is_active limit 1;
  if v_courier_id is not null then
    update orders set courier_id = v_courier_id where id = p_order_id;
    perform transition_order_status(p_order_id, 'COURIER_ASSIGNED');
  end if;
end;
$$ language plpgsql security definer set search_path = public;
