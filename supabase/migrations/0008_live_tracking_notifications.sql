-- Phase 6: live order tracking + notifications.

-- Realtime: tables aren't broadcast by default, they have to be added to
-- the publication explicitly. Without this, a client-side subscription on
-- orders would just sit there forever getting nothing.
alter publication supabase_realtime add table orders;

-- One token per account, not a device table — V1 doesn't need multi-device
-- push, and this can be revisited if that ever matters. Not margin-
-- sensitive, so no special RLS/column treatment: it rides along with
-- profiles' existing policies (own row, admin, and — deliberately, since
-- it's harmless — the courier-can-see-their-assigned-customer's-profile
-- policy from 0007).
alter table profiles add column expo_push_token text;

-- Fires on every order_status_history insert, no matter which of the
-- several paths wrote it (Stripe webhook, courier RPC call, admin action)
-- — that's the point of hanging this off the history table instead of
-- duplicating a notify-call at every call site that can change status.
-- Which statuses actually warrant a push is decided in exactly one place:
-- the send-order-notification Edge Function's own mapping, not here — a
-- second filter here would just be a second place that could disagree
-- with the function about what "notify-worthy" means.
create function notify_order_status_change() returns trigger as $$
begin
  perform net.http_post(
    url := current_setting('app.settings.notification_trigger_url', true),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-trigger-secret', current_setting('app.settings.notification_trigger_secret', true)
    ),
    body := jsonb_build_object('order_id', new.order_id, 'new_status', new.new_status)
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger order_status_history_notify
  after insert on order_status_history
  for each row execute function notify_order_status_change();

-- Same as 0005_menu_sync_cron.sql: app.settings.notification_trigger_url/
-- secret are NOT set here — there's no deployed Edge Function URL yet.
-- Until they're set (alter database postgres set app.settings...), this
-- trigger fires on every status change and every pg_net call fails against
-- an empty URL — visible in the net extension's request log, not a silent
-- no-op, and it never blocks the status transition itself (pg_net is
-- fire-and-forget/async, not a synchronous call the transaction waits on).
