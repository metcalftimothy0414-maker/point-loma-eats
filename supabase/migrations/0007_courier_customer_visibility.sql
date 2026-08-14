-- Phase 5: the courier dashboard needs to show who an order is for, but
-- the existing profiles RLS (0001) only lets someone read their own row or
-- an admin read any row — a courier has no path to a customer's
-- name/phone at all, even for an order assigned to them. Scoped narrowly:
-- only the customer on an order this specific courier is assigned to,
-- never a blanket "couriers can read all profiles."

create policy "profiles_select_via_assigned_order" on profiles
  for select using (
    exists (
      select 1 from orders o
      where o.customer_id = profiles.id and o.courier_id = auth.uid()
    )
  );
