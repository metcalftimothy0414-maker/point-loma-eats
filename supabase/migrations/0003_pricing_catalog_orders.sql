-- Pricing engine + enough of the restaurant/order model for it to attach to
-- something real. Full restaurant management (Phase 3) and the order state
-- machine + payments (Phase 4) are not built here — this only lays the seam
-- the requested pricing columns need to make sense.

-- pricing_settings ----------------------------------------------------------
-- Versioned by effective_from so a price change can be scheduled ahead of
-- time. Never client-readable: markup_pct/on_demand_markup_pct expose margin.

create table pricing_settings (
  id uuid primary key default gen_random_uuid(),
  markup_pct numeric not null default 0.45 check (markup_pct >= 0),
  minimum_subtotal numeric not null default 15.00 check (minimum_subtotal >= 0),
  on_demand_markup_pct numeric not null default 0.55 check (on_demand_markup_pct >= 0),
  effective_from timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index pricing_settings_effective_from_idx on pricing_settings (effective_from desc);

-- Seed the initial rates. Without a row here the table is empty and every
-- menu item silently prices at 0% markup until someone remembers to add one.
insert into pricing_settings default values;

alter table pricing_settings enable row level security;
-- No policies: RLS defaults to deny for anon/authenticated. Admin tooling
-- (Phase 7) reads/writes this with the service role key, which bypasses RLS.

create function current_pricing_settings() returns pricing_settings as $$
  select * from pricing_settings
  where effective_from <= now()
  order by effective_from desc
  limit 1;
$$ language sql stable security definer set search_path = public;

-- restaurants / menu -------------------------------------------------------
-- Minimal shell: enough to hang a menu and an order off of. Hours, images,
-- modifiers, POS integration etc. are Phase 3.

create table restaurants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  phone text,
  is_active boolean not null default true,
  pickup_instructions text,
  estimated_prep_minutes int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  category_id uuid references menu_categories (id) on delete set null,
  name text not null,
  description text,
  base_price numeric not null check (base_price >= 0),
  -- Can't be a real GENERATED column: the multiplier lives in pricing_settings,
  -- a different table, and Postgres generated columns may only reference the
  -- same row. Maintained by trigger instead so it's still never client-set.
  display_price numeric not null default 0,
  is_available boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index menu_categories_restaurant_id_idx on menu_categories (restaurant_id);
create index menu_items_restaurant_id_idx on menu_items (restaurant_id);

create trigger restaurants_set_updated_at
  before update on restaurants
  for each row execute function set_updated_at();
create trigger menu_items_set_updated_at
  before update on menu_items
  for each row execute function set_updated_at();

create function set_menu_item_display_price() returns trigger as $$
declare
  markup numeric;
begin
  select markup_pct into markup from current_pricing_settings();
  new.display_price := round(new.base_price * (1 + coalesce(markup, 0)), 2);
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger menu_items_set_display_price
  before insert or update of base_price on menu_items
  for each row execute function set_menu_item_display_price();

-- ponytail: repricing on a new pricing_settings row is eager (applies as soon
-- as the row is inserted, even if effective_from is future-dated) — there's
-- no scheduler here to flip prices at the exact instant effective_from is
-- reached. Add one (pg_cron or similar) if scheduled price changes matter.
create function reprice_menu_items() returns trigger as $$
begin
  -- Only reprice if this row is actually the current one (highest
  -- effective_from <= now()) — otherwise backfilling an older historical
  -- pricing_settings row would clobber live prices with a stale markup.
  if new.id = (select id from current_pricing_settings()) then
    update menu_items set display_price = round(base_price * (1 + new.markup_pct), 2);
  end if;
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger pricing_settings_reprice
  after insert on pricing_settings
  for each row execute function reprice_menu_items();

alter table restaurants enable row level security;
alter table menu_categories enable row level security;
alter table menu_items enable row level security;

create policy "restaurants_select_active_or_admin" on restaurants
  for select using (is_active or is_admin());
create policy "restaurants_admin_write" on restaurants
  for all using (is_admin()) with check (is_admin());

create policy "menu_categories_select_all" on menu_categories
  for select using (true);
create policy "menu_categories_admin_write" on menu_categories
  for all using (is_admin()) with check (is_admin());

create policy "menu_items_select_or_admin" on menu_items
  for select using (is_available or is_admin());
create policy "menu_items_admin_write" on menu_items
  for all using (is_admin()) with check (is_admin());

-- base_price is restaurant cost, not for customer eyes: it would let anyone
-- back out exactly what we pay by comparing it to display_price. Column-level
-- grant hides it from the RLS-bound client roles; service role still sees it.
revoke select on menu_items from anon, authenticated;
grant select (
  id, restaurant_id, category_id, name, description,
  display_price, is_available, created_at, updated_at
) on menu_items to anon, authenticated;

-- orders (minimal shell) ----------------------------------------------------
-- Just enough to record what a delivery actually cost/earned. No order_items,
-- no state machine, no payments capture — that's Phase 4. status is a bare
-- placeholder, not the 17-state machine from the brief.

create table orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id),
  restaurant_id uuid not null references restaurants (id),
  delivery_point_id uuid not null references delivery_points (id),
  courier_id uuid references couriers (id),
  status text not null default 'created',
  food_cost numeric not null default 0 check (food_cost >= 0),
  customer_total numeric not null default 0 check (customer_total >= 0),
  gross_margin numeric generated always as (customer_total - food_cost) stored,
  -- Reserved seams, not wired to anything yet: delivery_windows/order_batches
  -- tables (scheduled orders, courier batching) are deferred future-expansion
  -- per the brief. No FK until those tables exist.
  delivery_window_id uuid,
  batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index orders_customer_id_idx on orders (customer_id);
create index orders_restaurant_id_idx on orders (restaurant_id);
create index orders_courier_id_idx on orders (courier_id);

create trigger orders_set_updated_at
  before update on orders
  for each row execute function set_updated_at();

alter table orders enable row level security;

-- Read-only for now: a customer sees their own orders, a courier sees orders
-- assigned to them, an admin sees all. No insert/update policy yet — writes
-- go through Phase 4's checkout function (or the service role), never a raw
-- client insert/update, so order creation can validate pricing/payment first.
create policy "orders_select_own_customer_or_courier_or_admin" on orders
  for select using (customer_id = auth.uid() or courier_id = auth.uid() or is_admin());

-- food_cost/gross_margin are our margin, not the customer's business.
revoke select on orders from anon, authenticated;
grant select (
  id, customer_id, restaurant_id, delivery_point_id, courier_id, status,
  customer_total, delivery_window_id, batch_id, created_at, updated_at
) on orders to anon, authenticated;
