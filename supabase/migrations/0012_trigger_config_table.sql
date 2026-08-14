-- Replaces the app.settings.* GUC indirection from 0005/0008: Supabase
-- rejects `alter database postgres set app.settings.*` with `permission
-- denied to set parameter` even for the postgres role (confirmed against
-- the live project 2026-08-13) — those two migrations' documented "set
-- this once you have a deployed URL" step was never actually achievable.
--
-- app_config is schema only here; no secret values are inserted by this
-- migration (or any migration, ever) — real values are set directly
-- against the live database, same as every other secret in this repo.

create table app_config (
  key text primary key,
  value text not null
);

alter table app_config enable row level security;
-- No policies, no grants to anon/authenticated — same treatment as
-- pricing_settings. Only a SECURITY DEFINER function (owner-bypasses-RLS,
-- same mechanism as is_admin()) or service_role can read this.
revoke all on app_config from anon, authenticated;

create or replace function notify_order_status_change() returns trigger as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_config where key = 'notification_trigger_url';
  if v_url is null then
    return new;
  end if;
  select value into v_secret from app_config where key = 'notification_trigger_secret';

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-trigger-secret', v_secret
    ),
    body := jsonb_build_object('order_id', new.order_id, 'new_status', new.new_status)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function run_menu_sync_trigger() returns void as $$
declare
  v_url text;
  v_secret text;
begin
  select value into v_url from app_config where key = 'menu_sync_trigger_url';
  if v_url is null then
    return;
  end if;
  select value into v_secret from app_config where key = 'menu_sync_trigger_secret';

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-trigger-secret', v_secret
    )
  );
end;
$$ language plpgsql security definer set search_path = public;

select cron.unschedule('menu-sync-nightly');

select cron.schedule(
  'menu-sync-nightly',
  '0 12 * * *',
  $$select run_menu_sync_trigger();$$
);
