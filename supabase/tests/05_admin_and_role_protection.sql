-- "Admin can manage all appropriate resources." (brief section 31.) Also
-- covers a gap none of the earlier files touch: a customer escalating
-- their own role, which the brief's security section (24) calls out by
-- name ("a client must NEVER be able to set is_admin=true").
--
-- Real nuance surfaced while writing this file: is_admin() (used inside
-- RLS policies) grants ROW-level access — a profiles.role='admin' user
-- connecting with their own JWT really can see every order, update any
-- restaurant, etc. But the column-level REVOKE/GRANT on food_cost/
-- gross_margin/base_price (0003) operates on the POSTGRES ROLE
-- ('authenticated'), which every signed-in user shares regardless of
-- profiles.role — Postgres privileges can't discriminate by row data like
-- "this particular authenticated user happens to be an admin." So an
-- admin connecting via their own JWT (role='authenticated' at the
-- Postgres level) is column-blocked from food_cost exactly like a
-- customer would be; only service_role escapes that. That's not a bug
-- here — admin/'s real app exclusively uses service_role (see its own
-- README) — but it's worth knowing this is why, not assuming an
-- authenticated "admin" JWT alone would be sufficient if that ever changes.

set role authenticated;
set request.jwt.claim.sub = '66666666-6666-6666-6666-666666666666';

select test_assert(
  (select count(*) from orders) >= 2,
  'admin (via is_admin(), an authenticated JWT) can see every order regardless of who owns it'
);

update restaurants set pickup_instructions = 'Ring the bell twice' where name = 'Test Taco Shop';
select test_assert(
  (select pickup_instructions from restaurants where name = 'Test Taco Shop') = 'Ring the bell twice',
  'admin can update a restaurant'
);

reset role;

-- The column-level side of "admin can manage all appropriate resources" —
-- food_cost specifically requires service_role, per the nuance above.
set role service_role;
select test_assert(
  (select count(*) from orders where food_cost is not null) = (select count(*) from orders),
  'food_cost is readable via service_role (how the real admin app actually gets elevated access)'
);
reset role;

-- A customer attempting to promote themselves to admin via a direct
-- update — the WITH CHECK clause on profiles_update_own_or_admin (0001)
-- should block changing role while still allowing the update to go
-- through for every other column (full_name here).
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$ begin
  update profiles set role = 'admin' where id = '11111111-1111-1111-1111-111111111111';
  if (select role from profiles where id = '11111111-1111-1111-1111-111111111111') = 'admin' then
    raise exception 'FAIL: customer successfully promoted themselves to admin';
  end if;
  raise notice 'PASS: a self-role-update to admin is silently rejected by RLS (0 rows updated), not an error';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: customer cannot set their own role to admin (%)', sqlerrm;
end $$;

update profiles set full_name = 'Customer A' where id = '11111111-1111-1111-1111-111111111111';
select test_assert(
  (select full_name from profiles where id = '11111111-1111-1111-1111-111111111111') = 'Customer A',
  'the same WITH CHECK clause still allows updating a non-role column on your own profile'
);

reset role;

select test_assert(
  (select role from profiles where id = '11111111-1111-1111-1111-111111111111') = 'customer',
  'customer A''s role is still customer after the escalation attempt above (verified as superuser, bypassing RLS)'
);
