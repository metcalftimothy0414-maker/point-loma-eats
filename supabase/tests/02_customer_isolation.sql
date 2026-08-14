-- "Customer A cannot see Customer B's orders." / "Customer cannot mark an
-- order delivered." / "Customer cannot modify payment status." (brief
-- section 31's explicit test list.)

set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

select order_id as customer_a_order_id from create_order(
  (select id from restaurants where name = 'Test Taco Shop'),
  (select id from delivery_points where name = 'Barracks A Lobby'),
  jsonb_build_array(jsonb_build_object(
    'menu_item_id', (select id from menu_items where name = 'Burrito'),
    'quantity', 2
  )),
  0
) \gset

select test_assert(:'customer_a_order_id' is not null, 'customer A can create an order');

select test_assert(
  (select count(*) from orders where id = :'customer_a_order_id') = 1,
  'customer A can see their own order'
);
select test_assert(
  (select count(*) from order_items where order_id = :'customer_a_order_id') = 1,
  'customer A can see their own order items'
);

-- NOTE: psql's :'var' substitution does not reach inside dollar-quoted
-- do $$ ... $$ blocks (by design, so it doesn't mangle :: casts in real
-- function bodies) — every reference to customer A's order below uses a
-- plain subquery instead, not the :'customer_a_order_id' psql variable.

-- "Customer cannot mark an order delivered" (or any status not in the
-- customer-cancel path) — CREATED -> DELIVERED isn't even a valid
-- transition, so this should fail on the graph check before authorization
-- is ever reached; either way it must fail.
do $$ begin
  perform transition_order_status(
    (select id from orders where customer_id = '11111111-1111-1111-1111-111111111111'),
    'DELIVERED'
  );
  raise exception 'FAIL: customer was able to mark their own order DELIVERED';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: customer cannot mark an order DELIVERED (%)', sqlerrm;
end $$;

-- A system-only transition a customer should never reach either, even
-- though PAYMENT_PENDING *is* graph-reachable from CREATED.
do $$ begin
  perform transition_order_status(
    (select id from orders where customer_id = '11111111-1111-1111-1111-111111111111'),
    'PAYMENT_PENDING'
  );
  raise exception 'FAIL: customer was able to set PAYMENT_PENDING directly';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: customer cannot set PAYMENT_PENDING directly (%)', sqlerrm;
end $$;

-- "Customer cannot modify payment status" — no insert/update policy on
-- payments at all for a client role.
do $$ begin
  insert into payments (order_id, stripe_payment_intent_id, amount, status)
    values (
      (select id from orders where customer_id = '11111111-1111-1111-1111-111111111111'),
      'pi_fake', 20.00, 'succeeded'
    );
  raise exception 'FAIL: customer was able to insert a payments row directly';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: customer cannot insert into payments directly (%)', sqlerrm;
end $$;

reset role;

-- Now as customer B: must see none of customer A's data.
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';

select test_assert(
  (select count(*) from orders where id = :'customer_a_order_id') = 0,
  'customer B sees zero rows for customer A''s order'
);
select test_assert(
  (select count(*) from order_items where order_id = :'customer_a_order_id') = 0,
  'customer B sees zero rows for customer A''s order items'
);
select test_assert(
  (select count(*) from order_status_history where order_id = :'customer_a_order_id') = 0,
  'customer B sees zero rows for customer A''s order status history'
);
select test_assert(
  (select full_name from profiles where id = '11111111-1111-1111-1111-111111111111') is null,
  'customer B cannot read customer A''s profile'
);

reset role;
