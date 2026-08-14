-- create_order()'s pricing math, minimum_subtotal enforcement, and
-- atomicity on failure — uses customer B so it doesn't interfere with
-- customer A's order from 02/03. Assumes the seeded pricing_settings
-- default (markup_pct 0.45, minimum_subtotal 15.00) is still current.

select test_assert(
  (select markup_pct from pricing_settings order by effective_from desc limit 1) = 0.45,
  'seeded default markup_pct is still 0.45 (this file''s math assumes it)'
);

select test_assert(
  (select display_price from menu_items where name = 'Burrito') = 14.50,
  'display_price = base_price * (1 + markup_pct): 10.00 * 1.45 = 14.50'
);

set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

-- Happy path: 1 burrito (14.50) + 1 taco (4.35) = 18.85, tip 2.00 -> 20.85.
select order_id, subtotal, tip_amount, customer_total from create_order(
  (select id from restaurants where name = 'Test Taco Shop'),
  (select id from delivery_points where name = 'Barracks A Lobby'),
  jsonb_build_array(
    jsonb_build_object('menu_item_id', (select id from menu_items where name = 'Burrito'), 'quantity', 1),
    jsonb_build_object('menu_item_id', (select id from menu_items where name = 'Taco'), 'quantity', 1)
  ),
  2.00
) \gset happy_

select test_assert(:'happy_subtotal' = '18.85', format('subtotal is 18.85, got %s', :'happy_subtotal'));
select test_assert(:'happy_customer_total' = '20.85', format('customer_total is 20.85, got %s', :'happy_customer_total'));

reset role;

-- food_cost is column-revoked from anon/authenticated (0003) — a customer
-- correctly cannot select it at all, so this checks it as service_role,
-- the same way admin/checkout-adjacent tooling actually would.
set role service_role;
select test_assert(
  (select food_cost from orders where id = :'happy_order_id'::uuid) = 13.00,
  'food_cost is the sum of base_price (10.00 + 3.00 = 13.00), not display_price'
);
reset role;

-- Atomicity: every failure mode below must leave zero new order rows.
-- Counted via service_role (stable full visibility) rather than as
-- customer B (RLS-filtered to just their own orders) specifically so this
-- checkpoint and the one after the failures are counting the same thing —
-- comparing an RLS-filtered count to an unfiltered one would only "pass"
-- by coincidence, not because the logic is actually right.
set role service_role;
select count(*) as orders_before_failures from orders \gset
reset role;

set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

do $$ begin
  perform create_order(
    (select id from restaurants where name = 'Test Taco Shop'),
    (select id from delivery_points where name = 'Barracks A Lobby'),
    jsonb_build_array(jsonb_build_object('menu_item_id', (select id from menu_items where name = 'Taco'), 'quantity', 1)),
    0
  );
  raise exception 'FAIL: create_order succeeded below the minimum_subtotal ($4.35 < $15.00)';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: create_order enforces minimum_subtotal (%)', sqlerrm;
end $$;

do $$ begin
  perform create_order(
    (select id from restaurants where name = 'Test Taco Shop'),
    (select id from delivery_points where name = 'Barracks A Lobby'),
    jsonb_build_array(jsonb_build_object('menu_item_id', (select id from menu_items where name = 'Burrito'), 'quantity', 1)),
    -5
  );
  raise exception 'FAIL: create_order accepted a negative tip';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: create_order rejects a negative tip (%)', sqlerrm;
end $$;

do $$ begin
  perform create_order(
    (select id from restaurants where name = 'Test Taco Shop'),
    (select id from delivery_points where name = 'Barracks A Lobby'),
    '[]'::jsonb,
    0
  );
  raise exception 'FAIL: create_order accepted an empty cart';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: create_order rejects an empty cart (%)', sqlerrm;
end $$;

reset role;

-- Unavailable item: toggle it off as service_role first (RLS would hide
-- an unavailable item's id from a plain customer lookup anyway).
update menu_items set is_available = false where name = 'Burrito';

set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

do $$ begin
  perform create_order(
    (select id from restaurants where name = 'Test Taco Shop'),
    (select id from delivery_points where name = 'Barracks A Lobby'),
    jsonb_build_array(jsonb_build_object(
      'menu_item_id', (select id from menu_items where name = 'Burrito'),
      'quantity', 1
    )),
    0
  );
  raise exception 'FAIL: create_order accepted an unavailable item';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: create_order rejects an unavailable item (%)', sqlerrm;
end $$;

reset role;
update menu_items set is_available = true where name = 'Burrito';

-- Counted as the connecting superuser, which — like service_role — sees
-- every row regardless of RLS, matching the visibility orders_before_failures
-- was captured under above. None of the 4 rejected create_order calls
-- should have added anything, so this must equal that baseline exactly.
select test_assert(
  (select count(*) from orders) = :orders_before_failures,
  format('order count unchanged by the 4 rejected create_order calls: before %s, after %s', :orders_before_failures, (select count(*) from orders))
);

-- Repricing: a new *current* pricing_settings row cascades to display_price
-- live; a backfilled historical row must not.
insert into pricing_settings (markup_pct) values (0.60);
select test_assert(
  (select display_price from menu_items where name = 'Burrito') = 16.00,
  'a new current pricing_settings row (markup 0.60) reprices display_price live: 10.00 * 1.60 = 16.00'
);

insert into pricing_settings (markup_pct, effective_from) values (0.10, now() - interval '30 days');
select test_assert(
  (select display_price from menu_items where name = 'Burrito') = 16.00,
  'backfilling an old historical pricing_settings row does not clobber the live display_price'
);
