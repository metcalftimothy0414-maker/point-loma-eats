import Link from 'next/link';
import { supabaseAdmin } from '../../lib/supabase-admin';

export const dynamic = 'force-dynamic';

export default async function PaymentsPage() {
  const supabase = supabaseAdmin();
  const { data: payments } = await supabase
    .from('payments')
    .select('id, order_id, stripe_payment_intent_id, amount, currency, status, refunded_amount, created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  const rows = payments ?? [];

  return (
    <main className="admin-main">
      <h1>Payments</h1>
      <table className="admin-table">
        <thead>
          <tr>
            <th>Order</th>
            <th>Stripe PI</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Refunded</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td>
                <Link href={`/orders/${p.order_id}`}>{p.order_id.slice(0, 8)}</Link>
              </td>
              <td className="admin-muted">{p.stripe_payment_intent_id}</td>
              <td>
                ${p.amount.toFixed(2)} {p.currency.toUpperCase()}
              </td>
              <td>{p.status}</td>
              <td>{p.refunded_amount != null ? `$${p.refunded_amount.toFixed(2)}` : '—'}</td>
              <td>{new Date(p.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6}>No payments yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </main>
  );
}
