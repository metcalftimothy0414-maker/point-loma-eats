-- Shared fixtures every other test file in this directory relies on.
-- Fixed UUIDs for users (not gen_random_uuid()) so later files can
-- reference them directly. Everything else is looked up by name in the
-- files that need it, rather than passed via psql variables — each test
-- file below runs as its own separate connection (so `set role`/
-- `set request.jwt.claim.sub` from one file can never leak into the
-- next), which means \gset variables wouldn't survive between files anyway.

insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'), -- customer A
  ('44444444-4444-4444-4444-444444444444'), -- customer B (unrelated to A)
  ('22222222-2222-2222-2222-222222222222'), -- courier
  ('33333333-3333-3333-3333-333333333333'), -- unrelated authenticated user (no role-specific row)
  ('66666666-6666-6666-6666-666666666666'); -- admin

update profiles set role = 'courier' where id = '22222222-2222-2222-2222-222222222222';
insert into couriers (id) values ('22222222-2222-2222-2222-222222222222');

update profiles set role = 'admin' where id = '66666666-6666-6666-6666-666666666666';

insert into installations (name, address) values ('Point Loma', '123 Test Ave');
insert into delivery_zones (installation_id, name)
  select id, 'Zone A' from installations where name = 'Point Loma';
insert into delivery_points (zone_id, name)
  select id, 'Barracks A Lobby' from delivery_zones where name = 'Zone A';

insert into restaurants (name, address) values ('Test Taco Shop', '456 Test St');
insert into menu_items (restaurant_id, name, base_price)
  select id, 'Burrito', 10.00 from restaurants where name = 'Test Taco Shop';
insert into menu_items (restaurant_id, name, base_price)
  select id, 'Taco', 3.00 from restaurants where name = 'Test Taco Shop';

select test_assert(true, 'fixtures loaded');
