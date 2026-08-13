-- Phase 1: auth-linked profiles + role-specific extension tables.
-- Later phases (installations, restaurants, orders, ...) are separate migrations.

create extension if not exists "pgcrypto";

create type user_role as enum ('customer', 'courier', 'admin');

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  role user_role not null default 'customer',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One-courier-for-now (the founder). Multi-courier fields (vehicle, verification,
-- payout account) get added here in a later phase rather than rebuilt.
create table couriers (
  id uuid primary key references profiles (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table customers (
  id uuid primary key references profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index profiles_role_idx on profiles (role);

-- Keep updated_at current on profile edits.
create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Auto-create a profile (and matching customer row) whenever someone signs up.
-- New accounts are customers by default; promotion to courier/admin is a
-- deliberate admin action (see README), never client-settable.
create function handle_new_user() returns trigger as $$
begin
  insert into profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');

  insert into customers (id) values (new.id);

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Row Level Security -------------------------------------------------------

alter table profiles enable row level security;
alter table customers enable row level security;
alter table couriers enable row level security;

create function is_admin() returns boolean as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$ language sql security definer stable set search_path = public;

-- profiles: a user can read/update their own row; admins can read/update all.
-- Nobody (including the owner) can set their own role from the client.
create policy "profiles_select_own_or_admin" on profiles
  for select using (id = auth.uid() or is_admin());

create policy "profiles_update_own_or_admin" on profiles
  for update using (id = auth.uid() or is_admin())
  with check (
    is_admin() or (id = auth.uid() and role = (select role from profiles where id = auth.uid()))
  );

-- customers: a user can read their own customer row; admins can read all.
create policy "customers_select_own_or_admin" on customers
  for select using (id = auth.uid() or is_admin());

-- couriers: a courier can read their own row; admins can read/manage all.
-- Insertion happens only via admin action (promoting a profile to courier).
create policy "couriers_select_own_or_admin" on couriers
  for select using (id = auth.uid() or is_admin());

create policy "couriers_admin_write" on couriers
  for insert with check (is_admin());

create policy "couriers_admin_update" on couriers
  for update using (is_admin());
