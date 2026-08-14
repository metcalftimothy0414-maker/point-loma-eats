-- Fixes a real bug in profiles_update_own_or_admin (0001), found by the
-- new test suite (supabase/tests/), not by any code path the app actually
-- exercises yet — the mobile app has never implemented profile editing,
-- so this has been silently broken since Phase 1 with nothing to surface it.
--
-- The policy's WITH CHECK clause has a raw subquery,
-- `role = (select role from profiles where id = auth.uid())`, directly
-- against the same table the policy is defined on. Unlike is_admin() (a
-- SECURITY DEFINER function, which runs its internal query as the
-- function owner and so doesn't get RLS-filtered), this raw subquery runs
-- as the calling role and IS subject to profiles' own RLS — which means
-- evaluating it requires re-evaluating profiles' policies, which requires
-- evaluating this subquery again, forever: "infinite recursion detected
-- in policy for relation profiles." This isn't a hypothetical — it's what
-- actually happens on any UPDATE to your own profiles row, not just a
-- role-escalation attempt.
--
-- Fix: wrap the self-reference in a SECURITY DEFINER function, exactly
-- the same pattern is_admin() already uses correctly.

create function current_user_role() returns user_role as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable set search_path = public;

revoke execute on function current_user_role() from public;
grant execute on function current_user_role() to authenticated;
-- (Not to anon: an anonymous caller has no profiles row to look up, and
-- this function only matters inside the policy below, which already
-- requires auth.uid() to be non-null to do anything useful.)

drop policy "profiles_update_own_or_admin" on profiles;

create policy "profiles_update_own_or_admin" on profiles
  for update using (id = auth.uid() or is_admin())
  with check (
    is_admin() or (id = auth.uid() and role = current_user_role())
  );
