import Link from 'next/link';
import { supabaseAdmin } from '../../lib/supabase-admin';

export const dynamic = 'force-dynamic';

export default async function CustomersPage() {
  const supabase = supabaseAdmin();
  const [profilesRes, ordersRes] = await Promise.all([
    supabase.from('profiles').select('id, full_name, phone, created_at').eq('role', 'customer').order('created_at', { ascending: false }),
    supabase.from('orders').select('customer_id, customer_total, status'),
  ]);

  const orderStatsByCustomer = new Map<string, { count: number; revenue: number }>();
  for (const o of ordersRes.data ?? []) {
    const stat = orderStatsByCustomer.get(o.customer_id) ?? { count: 0, revenue: 0 };
    stat.count += 1;
    if (o.status === 'DELIVERED') stat.revenue += o.customer_total;
    orderStatsByCustomer.set(o.customer_id, stat);
  }

  const profiles = profilesRes.data ?? [];

  return (
    <main className="admin-main">
      <h1>Customers</h1>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Phone</th>
            <th>Orders</th>
            <th>Revenue (delivered)</th>
            <th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => {
            const stat = orderStatsByCustomer.get(p.id) ?? { count: 0, revenue: 0 };
            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/customers/${p.id}`}>{p.full_name ?? '(no name)'}</Link>
                </td>
                <td>{p.phone ?? '—'}</td>
                <td>{stat.count}</td>
                <td>${stat.revenue.toFixed(2)}</td>
                <td>{new Date(p.created_at).toLocaleDateString()}</td>
              </tr>
            );
          })}
          {profiles.length === 0 && (
            <tr>
              <td colSpan={5}>No customers yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
