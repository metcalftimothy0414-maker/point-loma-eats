-- Schedules the nightly menu sync. pg_cron only speaks SQL, so it can't
-- invoke services/menu-sync (a Node process) directly — it POSTs to that
-- service's HTTP trigger endpoint (services/menu-sync/http-server.ts)
-- instead, via pg_net.
--
-- app.settings.menu_sync_trigger_url and app.settings.menu_sync_trigger_secret
-- are NOT set by this migration — there's no deployed URL for the service
-- yet (where it actually runs is a deployment decision not made). Set them
-- once that exists:
--   alter database postgres set app.settings.menu_sync_trigger_url = 'https://...:/trigger';
--   alter database postgres set app.settings.menu_sync_trigger_secret = '...';
-- Until then this job runs on schedule but every call fails against an
-- empty URL — visible in cron.job_run_details, not a silent no-op.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 12:00 UTC = 4am PST / 5am PDT. pg_cron on Supabase runs in UTC with no
-- per-job timezone option, so this drifts an hour twice a year across DST
-- rather than always landing exactly at 4am Point Loma time — accepted for
-- a single-installation MVP rather than building timezone-aware scheduling.
select cron.schedule(
  'menu-sync-nightly',
  '0 12 * * *',
  $$
  select net.http_post(
    url := current_setting('app.settings.menu_sync_trigger_url', true),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-trigger-secret', current_setting('app.settings.menu_sync_trigger_secret', true)
    )
  );
  $$
);
