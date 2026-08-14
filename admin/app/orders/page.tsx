import Link from 'next/link';
import { supabaseAdmin } from '../../lib/supabase-admin';

export const dynamic = 'force-dynamic';

const ALL_STATUSES = [
  'CREATED', 'PAYMENT_PENDING', 'PAID', 'CONFIRMED', 'COURIER_ASSIGNED', 'COURIER_ACCEPTED',
  'AT_RESTAURANT', 'ORDER_PICKED_UP', 'EN_ROUTE', 'ON_INSTALLATION', 'APPROACHING', 'ARRIVED',
  'DELIVERED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'DISPUTED',
];

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const supabase = supabaseAdmin();

  let query = supabase
    .from('orders')
    .select('id, status, customer_total, restaurant_id, customer_id, created_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (status) query = query.eq('status', status);

  const { data: orders } = await query;
  const rows = orders ?? [];

  const restaurantIds = [...new Set(rows.map((o) => o.restaurant_id))];
  const customerIds = [...new Set(rows.map((o) => o.customer_id))];
  const [restaurantsRes, customersRes] = await Promise.all([
    restaurantIds.length
      ? supabase.from('restaurants').select('id, name').in('id', restaurantIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    customerIds.length
      ? supabase.from('profiles').select('id, full_name').in('id', customerIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
  ]);
  const restaurantNameById = new Map((restaurantsRes.data ?? []).map((r) => [r.id, r.name]));
  const customerNameById = new Map((customersRes.data ?? []).map((c) => [c.id, c.full_name]));

  return (
    <main className="admin-main">
      <h1>Orders</h1>

      <form className="admin-form-row">
        <select className="admin-select" name="status" defaultValue={status ?? ''}>
          <option value="">All statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button className="admin-btn" type="submit">
          Filter
        </button>
      </form>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Status</th>
            <th>Restaurant</th>
            <th>Customer</th>
            <th>Total</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>
                <Link href={`/orders/${o.id}`}>{o.id.slice(0, 8)}</Link>
              </td>
              <td>{o.status}</td>
              <td>{restaurantNameById.get(o.restaurant_id) ?? '—'}</td>
              <td>{customerNameById.get(o.customer_id) ?? '—'}</td>
              <td>${o.customer_total.toFixed(2)}</td>
              <td>{new Date(o.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6}>No orders{status ? ` with status ${status}` : ''}.</td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
