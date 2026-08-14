import { supabaseAdmin } from '../../lib/supabase-admin';
import { createSupportTicket, resolveSupportTicket } from '../../lib/support-actions';

export const dynamic = 'force-dynamic';

const CATEGORIES = [
  'MISSING_ITEM', 'WRONG_ITEM', 'FOOD_DAMAGED', 'LATE_DELIVERY', 'ORDER_NEVER_ARRIVED', 'PAYMENT_PROBLEM', 'OTHER',
];

export default async function SupportPage() {
  const supabase = supabaseAdmin();
  const { data: tickets } = await supabase
    .from('support_tickets')
    .select('id, order_id, customer_id, category, description, status, resolution_notes, created_at')
    .order('created_at', { ascending: false });

  const rows = tickets ?? [];
  const customerIds = [...new Set(rows.map((t) => t.customer_id))];
  const { data: customers } = customerIds.length
    ? await supabase.from('profiles').select('id, full_name').in('id', customerIds)
    : { data: [] as { id: string; full_name: string | null }[] };
  const customerNameById = new Map((customers ?? []).map((c) => [c.id, c.full_name]));

  const open = rows.filter((t) => t.status === 'OPEN');
  const resolved = rows.filter((t) => t.status === 'RESOLVED');

  return (
    <main className="admin-main">
      <h1>Support</h1>
      <p className="admin-muted">
        No customer self-service &quot;report a problem&quot; flow exists yet (that&apos;s mobile-app work, not part
        of this admin dashboard) — tickets are logged here on a customer&apos;s behalf after they call or text.
      </p>

      <section className="admin-section">
        <h2>Log a ticket</h2>
        <form action={createSupportTicket} className="admin-form-row">
          <input className="admin-input" name="order_id" placeholder="Order ID" required style={{ width: 300 }} />
          <select className="admin-select" name="category" required defaultValue="">
            <option value="" disabled>
              Category
            </option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input className="admin-input" name="description" placeholder="Description (optional)" style={{ width: 300 }} />
          <button className="admin-btn" type="submit">
            Log ticket
          </button>
        </form>
      </section>

      <section className="admin-section">
        <h2>Open ({open.length})</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Category</th>
              <th>Description</th>
              <th>Opened</th>
              <th>Resolve</th>
            </tr>
          </thead>
          <tbody>
            {open.map((t) => (
              <tr key={t.id}>
                <td>{t.order_id.slice(0, 8)}</td>
                <td>{customerNameById.get(t.customer_id) ?? '—'}</td>
                <td>{t.category}</td>
                <td>{t.description ?? '—'}</td>
                <td>{new Date(t.created_at).toLocaleString()}</td>
                <td>
                  <form action={resolveSupportTicket.bind(null, t.id)} className="admin-form-row">
                    <input className="admin-input" name="resolution_notes" placeholder="Resolution notes" />
                    <button className="admin-btn" type="submit">
                      Resolve
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {open.length === 0 && (
              <tr>
                <td colSpan={6}>Nothing open.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <h2>Resolved</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>Category</th>
              <th>Resolution</th>
            </tr>
          </thead>
          <tbody>
            {resolved.map((t) => (
              <tr key={t.id}>
                <td>{t.order_id.slice(0, 8)}</td>
                <td>{customerNameById.get(t.customer_id) ?? '—'}</td>
                <td>{t.category}</td>
                <td>{t.resolution_notes ?? '—'}</td>
              </tr>
            ))}
            {resolved.length === 0 && (
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
