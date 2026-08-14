-- Stubs the parts of a real Supabase project that a plain local Postgres
-- doesn't have, just enough to apply every migration and exercise RLS
-- realistically: the auth schema/roles, the supabase_realtime publication,
-- and the pg_net extension (used by pg_cron-triggered notifications/menu
-- sync — pg_cron/pg_net themselves aren't installable outside a real
-- Supabase instance, so only their call surface is stubbed here).
--
-- test_assert() is the one piece that's genuinely ours, not a stub: every
-- test file uses it to report pass/fail with a clear message rather than
-- just aborting on the first raw SQL error.

create extension if not exists "pgcrypto";

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  raw_user_meta_data jsonb
);
-- Settable per-session (set request.jwt.claim.sub) so tests can act as
-- different users, the same way a real request's JWT would populate this.
create function auth.uid() returns uuid as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$ language sql stable;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  -- Real Supabase's service_role has BYPASSRLS set on the Postgres role
  -- itself — that's the actual mechanism behind "service role bypasses
  -- RLS," not something PostgREST fakes at the API layer.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase bootstraps every project with default privileges like this, so
-- RLS (not table-level GRANT) is the real gate for ordinary tables.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;
-- Function EXECUTE is NOT re-granted here: Postgres already grants EXECUTE
-- to PUBLIC automatically at CREATE FUNCTION time regardless of this
-- stub — that's the actual mechanism behind the current_pricing_settings()
-- bug fixed in 0003, not something Supabase adds on top.

create publication supabase_realtime;

create schema net;
create function net.http_post(url text, headers jsonb default '{}'::jsonb, body jsonb default '{}'::jsonb) returns bigint as $$
  select 1::bigint
$$ language sql;

create function test_assert(condition boolean, message text) returns void as $$
begin
  if condition then
    raise notice 'PASS: %', message;
  else
    raise exception 'FAIL: %', message;
  end if;
end;
$$ language plpgsql;
