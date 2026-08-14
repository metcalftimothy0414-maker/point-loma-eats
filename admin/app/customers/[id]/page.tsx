import { notFound } from 'next/navigation';
import Link from 'next/link';
import { supabaseAdmin } from '../../../lib/supabase-admin';

export const dynamic = 'force-dynamic';

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = supabaseAdmin();

  const { data: profile } = await supabase.from('profiles').select('id, full_name, phone, created_at').eq('id', id).single();
  if (!profile) notFound();

  const [ordersRes, ticketsRes] = await Promise.all([
    supabase
      .from('orders')
      .select('id, status, customer_total, created_at, restaurant_id')
      .eq('customer_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('support_tickets')
      .select('id, category, status, created_at')
      .eq('customer_id', id)
      .order('created_at', { ascending: false }),
  ]);

  const orders = ordersRes.data ?? [];
  const restaurantIds = [...new Set(orders.map((o) => o.restaurant_id))];
  const { data: restaurants } = restaurantIds.length
    ? await supabase.from('restaurants').select('id, name').in('id', restaurantIds)
    : { data: [] as { id: string; name: string }[] };
  const restaurantNameById = new Map((restaurants ?? []).map((r) => [r.id, r.name]));

  const tickets = ticketsRes.data ?? [];

  return (
    <main className="admin-main">
      <h1>{profile.full_name ?? '(no name)'}</h1>
      <p>Phone: {profile.phone ?? '—'}</p>
      <p>Joined: {new Date(profile.created_at).toLocaleDateString()}</p>

      <section className="admin-section">
        <h2>Orders</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Restaurant</th>
              <th>Status</th>
              <th>Total</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/orders/${o.id}`}>{o.id.slice(0, 8)}</Link>
                </td>
                <td>{restaurantNameById.get(o.restaurant_id) ?? '—'}</td>
                <td>{o.status}</td>
                <td>${o.customer_total.toFixed(2)}</td>
                <td>{new Date(o.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={5}>No orders yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <h2>Support tickets</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Status</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <td>{t.category}</td>
                <td>{t.status}</td>
                <td>{new Date(t.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {tickets.length === 0 && (
              <tr>
                <td colSpan={3}>No tickets.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
