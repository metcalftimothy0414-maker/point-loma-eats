-- Phase 2: installations -> delivery zones -> approved delivery points.
-- Customers pick a named point ("Barracks A Lobby"), never a raw room number.

create type installation_status as enum ('active', 'inactive');

create table installations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null,
  delivery_radius_meters int,
  operating_hours jsonb,
  status installation_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table delivery_zones (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references installations (id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table delivery_points (
  id uuid primary key default gen_random_uuid(),
  zone_id uuid not null references delivery_zones (id) on delete cascade,
  name text not null,
  instructions text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index delivery_zones_installation_id_idx on delivery_zones (installation_id);
create index delivery_points_zone_id_idx on delivery_points (zone_id);

create trigger installations_set_updated_at
  before update on installations
  for each row execute function set_updated_at();

-- RLS: this is non-sensitive catalog data (names/addresses of drop-off spots).
-- Anyone signed in can browse it; only admins can manage it.

alter table installations enable row level security;
alter table delivery_zones enable row level security;
alter table delivery_points enable row level security;

create policy "installations_select_active_or_admin" on installations
  for select using (status = 'active' or is_admin());
create policy "installations_admin_write" on installations
  for all using (is_admin()) with check (is_admin());

create policy "delivery_zones_select_active_or_admin" on delivery_zones
  for select using (is_active or is_admin());
create policy "delivery_zones_admin_write" on delivery_zones
  for all using (is_admin()) with check (is_admin());

create policy "delivery_points_select_active_or_admin" on delivery_points
  for select using (is_active or is_admin());
create policy "delivery_points_admin_write" on delivery_points
  for all using (is_admin()) with check (is_admin());
