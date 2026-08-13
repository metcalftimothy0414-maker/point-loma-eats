-- Automated menu sync: schema only. The pipeline itself (Places lookup,
-- site fetch, platform adapters, Claude-vision fallback, diff, apply) lives
-- in services/menu-sync/ as a separate Node process — not part of this
-- migration. Runs use the service role key and bypass RLS entirely; the
-- policies below only govern what the admin dashboard (a real user session)
-- can see and do.

create type menu_sync_status as enum ('success', 'partial', 'failed', 'blocked');
create type menu_item_change_type as enum ('price', 'availability', 'new', 'delete');
create type menu_item_change_status as enum ('auto_applied', 'pending_review', 'approved', 'rejected');

create table menu_sync_runs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants (id) on delete cascade,
  source_platform text not null,
  source_url text,
  status menu_sync_status not null,
  items_found int not null default 0,
  items_changed int not null default 0,
  error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table menu_item_changes (
  id uuid primary key default gen_random_uuid(),
  sync_run_id uuid not null references menu_sync_runs (id) on delete cascade,
  -- Null means either "new item" (nothing existed to reference yet) or the
  -- referenced item was later hard-deleted (on delete set null) — audit
  -- history should survive a menu item going away, not vanish with it.
  menu_item_id uuid references menu_items (id) on delete set null,
  change_type menu_item_change_type not null,
  old_value jsonb,
  new_value jsonb,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  status menu_item_change_status not null default 'pending_review',
  reviewed_by uuid references profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index menu_sync_runs_restaurant_id_idx on menu_sync_runs (restaurant_id);
create index menu_item_changes_sync_run_id_idx on menu_item_changes (sync_run_id);
create index menu_item_changes_pending_idx on menu_item_changes (status) where status = 'pending_review';

alter table menu_items
  add column source_platform text,
  add column source_item_id text,
  add column last_synced_at timestamptz,
  add column sync_confidence numeric check (sync_confidence is null or (sync_confidence between 0 and 1)),
  add column manual_override boolean not null default false;

-- Sync writes base_price only. display_price stays derived from
-- base_price * (1 + markup_pct) via the menu_items_set_display_price
-- trigger from 0003 — apply.ts (not built yet) must never assign
-- display_price directly; there's no DB-level way to enforce "which column
-- a specific caller is allowed to write," so this is a code-review rule,
-- not a constraint.

alter table restaurants
  add column google_place_id text,
  add column website_url text,
  add column sync_enabled boolean not null default true,
  add column sync_status text,
  add column last_sync_at timestamptz;

alter table menu_sync_runs enable row level security;
alter table menu_item_changes enable row level security;

-- Admin dashboard only reads run history...
create policy "menu_sync_runs_select_admin" on menu_sync_runs
  for select using (is_admin());

-- ...and reads + reviews (approve/reject) pending changes. Nothing here
-- lets an admin *client* insert a run or a change row — those only ever
-- come from the sync service via the service role key, which bypasses RLS.
create policy "menu_item_changes_select_admin" on menu_item_changes
  for select using (is_admin());
create policy "menu_item_changes_review_admin" on menu_item_changes
  for update using (is_admin())
  with check (is_admin());
