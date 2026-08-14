-- "Courier cannot access unrelated orders." / "Courier cannot change an
-- order into an invalid state." (brief section 31.) Continues the order
-- customer A created in 02_customer_isolation.sql, which is still at
-- CREATED — every transition attempted there was rejected.
--
-- NOTE: psql's :'var' substitution does not reach inside dollar-quoted
-- do $$ ... $$ blocks. Where the acting role can see the order via a
-- normal subquery (the courier, once assigned), this file uses that.
-- Where it explicitly can't (the "unrelated user" case — the whole point
-- of that test), the order id is passed in via a session-local custom GUC
-- set from plain (non-dollar-quoted) SQL, where :'var' substitutes fine,
-- then read back inside the do block with current_setting() — that needs
-- no psql substitution at all, so it isn't affected by the same issue.

set role service_role;

select id as order_id from orders
  where customer_id = '11111111-1111-1111-1111-111111111111'
  order by created_at limit 1 \gset

select test_assert(:'order_id' is not null, 'order from 02_customer_isolation.sql is visible to service_role');

set plm_test.order_id = :'order_id';

-- Drive it to COURIER_ASSIGNED via the same path the Stripe webhook uses.
select transition_order_status(:'order_id'::uuid, 'PAYMENT_PENDING');
select transition_order_status(:'order_id'::uuid, 'PAID');
select confirm_and_assign_order(:'order_id'::uuid);

select test_assert(
  (select status = 'COURIER_ASSIGNED' and courier_id = '22222222-2222-2222-2222-222222222222' from orders where id = :'order_id'),
  'confirm_and_assign_order() reaches COURIER_ASSIGNED and assigns the sole active courier'
);

reset role;

-- An unrelated authenticated user (not the assigned courier) must not be
-- able to see or advance this order.
set role authenticated;
set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';

select test_assert(
  (select count(*) from orders where customer_id = '11111111-1111-1111-1111-111111111111') = 0,
  'an unrelated user sees zero rows for an order that is not theirs (RLS)'
);

do $$
declare
  v_order_id uuid := current_setting('plm_test.order_id')::uuid;
begin
  perform transition_order_status(v_order_id, 'COURIER_ACCEPTED');
  raise exception 'FAIL: an unrelated user advanced an order that was not assigned to them';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: an unrelated user cannot advance an order not assigned to them (%)', sqlerrm;
end $$;

do $$
declare
  v_order_id uuid := current_setting('plm_test.order_id')::uuid;
begin
  perform transition_order_status(v_order_id, 'CANCELLED');
  raise exception 'FAIL: an unrelated user cancelled an order that was not theirs';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: an unrelated user cannot cancel an order that is not theirs (%)', sqlerrm;
end $$;

reset role;

-- The actual assigned courier: valid forward progress works...
set role authenticated;
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select id as order_id from orders
  where courier_id = '22222222-2222-2222-2222-222222222222'
  order by created_at limit 1 \gset

select transition_order_status(:'order_id'::uuid, 'COURIER_ACCEPTED');
select test_assert(
  (select status = 'COURIER_ACCEPTED' from orders where id = :'order_id'),
  'the assigned courier can accept their own order'
);

-- ...but skipping states in the graph does not, even for the correct
-- courier. The courier CAN see their own assigned order, so this uses a
-- plain subquery rather than the GUC trick above.
do $$ begin
  perform transition_order_status(
    (select id from orders where courier_id = '22222222-2222-2222-2222-222222222222'),
    'DELIVERED'
  );
  raise exception 'FAIL: courier skipped straight from COURIER_ACCEPTED to DELIVERED';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: courier cannot skip states even for their own order (%)', sqlerrm;
end $$;

-- ...and a courier cannot self-issue a system-only transition.
do $$ begin
  perform transition_order_status(
    (select id from orders where courier_id = '22222222-2222-2222-2222-222222222222'),
    'REFUND_PENDING'
  );
  raise exception 'FAIL: courier was able to self-issue REFUND_PENDING';
exception when others then
  if sqlerrm like 'FAIL:%' then raise; end if;
  raise notice 'PASS: courier cannot self-issue a refund (%)', sqlerrm;
end $$;

-- Walk the rest of the way to DELIVERED, one legal hop at a time.
select transition_order_status(:'order_id'::uuid, 'AT_RESTAURANT');
select transition_order_status(:'order_id'::uuid, 'ORDER_PICKED_UP');
select transition_order_status(:'order_id'::uuid, 'EN_ROUTE');
select transition_order_status(:'order_id'::uuid, 'ON_INSTALLATION');
select transition_order_status(:'order_id'::uuid, 'APPROACHING');
select transition_order_status(:'order_id'::uuid, 'ARRIVED');
select transition_order_status(:'order_id'::uuid, 'DELIVERED');

select test_assert(
  (select status = 'DELIVERED' from orders where id = :'order_id'),
  'courier can walk the full legal path to DELIVERED'
);
-- CREATED, PAYMENT_PENDING, PAID, CONFIRMED, COURIER_ASSIGNED,
-- COURIER_ACCEPTED, AT_RESTAURANT, ORDER_PICKED_UP, EN_ROUTE,
-- ON_INSTALLATION, APPROACHING, ARRIVED, DELIVERED = 13 rows.
select test_assert(
  (select count(*) from order_status_history where order_id = :'order_id') = 13,
  format('every legal transition is recorded in order_status_history: expected 13, got %s',
    (select count(*) from order_status_history where order_id = :'order_id'))
);

reset role;
