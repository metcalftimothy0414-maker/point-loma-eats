import Link from 'next/link';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { issueRefund } from '../../lib/orders-actions';

export const dynamic = 'force-dynamic';

export default async function RefundsPage() {
  const supabase = supabaseAdmin();

  const [pendingRes, refundedRes] = await Promise.all([
    supabase
      .from('orders')
      .select('id, customer_id, customer_total, updated_at')
      .eq('status', 'REFUND_PENDING')
      .order('updated_at', { ascending: false }),
    supabase
      .from('orders')
      .select('id, customer_id, customer_total, updated_at')
      .eq('status', 'REFUNDED')
      .order('updated_at', { ascending: false })
      .limit(50),
  ]);

  const pending = pendingRes.data ?? [];
  const refunded = refundedRes.data ?? [];
  const customerIds = [...new Set([...pending, ...refunded].map((o) => o.customer_id))];
  const { data: customers } = customerIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', customerIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const customerNameById = new Map((customers ?? []).map((c) => [c.id, c.full_name]));

  return (
    <main className="admin-main">
      <h1>Refunds</h1>

      <section className="admin-section">
        <h2>Awaiting refund ({pending.length})</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Since</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pending.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/orders/${o.id}`}>{o.id.slice(0, 8)}</Link>
                </td>
                <td>{customerNameById.get(o.customer_id) ?? '—'}</td>
                <td>${o.customer_total.toFixed(2)}</td>
                <td>{new Date(o.updated_at).toLocaleString()}</td>
                <td>
                  <form
                    action={async () => {
                      'use server';
                      await issueRefund(o.id, null);
                    }}
                  >
                    <button className="admin-btn admin-btn-danger" type="submit">
                      Issue full refund
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {pending.length === 0 && (
              <tr>
                <td colSpan={5}>Nothing waiting.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <h2>Recently refunded</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Amount</th>
              <th>Refunded</th>
            </tr>
          </thead>
          <tbody>
            {refunded.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link href={`/orders/${o.id}`}>{o.id.slice(0, 8)}</Link>
                </td>
                <td>{customerNameById.get(o.customer_id) ?? '—'}</td>
                <td>${o.customer_total.toFixed(2)}</td>
                <td>{new Date(o.updated_at).toLocaleString()}</td>
              </tr>
            ))}
            {refunded.length === 0 && (
              <tr>
                <td colSpan={4}>None yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
