import { notFound } from 'next/navigation';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { setOrderStatus, issueRefund } from '../../../lib/orders-actions';

export const dynamic = 'force-dynamic';

const ALL_STATUSES = [
  'CREATED', 'PAYMENT_PENDING', 'PAID', 'CONFIRMED', 'COURIER_ASSIGNED', 'COURIER_ACCEPTED',
  'AT_RESTAURANT', 'ORDER_PICKED_UP', 'EN_ROUTE', 'ON_INSTALLATION', 'APPROACHING', 'ARRIVED',
  'DELIVERED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED', 'DISPUTED',
];

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = supabaseAdmin();

  const { data: order } = await supabase
    .from('orders')
    .select(
      'id, status, restaurant_id, customer_id, courier_id, delivery_point_id, subtotal, tip_amount, customer_total, food_cost, gross_margin, created_at'
    )
    .eq('id', id)
    .single();

  if (!order) notFound();

  const [itemsRes, historyRes, restaurantRes, customerRes, courierRes, deliveryPointRes, paymentsRes] = await Promise.all([
    supabase.from('order_items').select('id, name, unit_price, quantity, line_total').eq('order_id', id),
    supabase.from('order_status_history').select('previous_status, new_status, created_at, actor_id').eq('order_id', id).order('created_at'),
    supabase.from('restaurants').select('name').eq('id', order.restaurant_id).single(),
    supabase.from('profiles').select('full_name, phone').eq('id', order.customer_id).single(),
    order.courier_id
      ? supabase.from('profiles').select('full_name, phone').eq('id', order.courier_id).single()
      : Promise.resolve({ data: null }),
    supabase.from('delivery_points').select('name').eq('id', order.delivery_point_id).single(),
    supabase.from('payments').select('stripe_payment_intent_id, amount, status, refunded_amount, created_at').eq('order_id', id),
  ]);

  const items = itemsRes.data ?? [];
  const history = historyRes.data ?? [];
  const hasSucceededPayment = (paymentsRes.data ?? []).some((p) => p.status === 'succeeded' && !p.refunded_amount);

  return (
    <main className="admin-main">
      <h1>
        Order {order.id.slice(0, 8)} — {order.status}
      </h1>

      <section className="admin-section">
        <p>Restaurant: {restaurantRes.data?.name ?? '—'}</p>
        <p>
          Customer: {customerRes.data?.full_name ?? '—'} {customerRes.data?.phone ? `(${customerRes.data.phone})` : ''}
        </p>
        <p>
          Courier: {order.courier_id ? `${courierRes.data?.full_name ?? '—'} (${courierRes.data?.phone ?? '—'})` : 'not assigned'}
        </p>
        <p>Delivery point: {deliveryPointRes.data?.name ?? '—'}</p>
        <p>Created: {new Date(order.created_at).toLocaleString()}</p>
      </section>

      <section className="admin-section">
        <h2>Items</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Unit price</th>
              <th>Qty</th>
              <th>Line total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>${item.unit_price.toFixed(2)}</td>
                <td>{item.quantity}</td>
                <td>${item.line_total.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>Subtotal: ${order.subtotal.toFixed(2)}</p>
        <p>Tip: ${order.tip_amount.toFixed(2)}</p>
        <p>
          <strong>Customer total: ${order.customer_total.toFixed(2)}</strong>
        </p>
        <p className="admin-muted">
          Food cost: ${order.food_cost.toFixed(2)} — gross margin: ${order.gross_margin.toFixed(2)} (admin-only; never
          shown to the customer)
        </p>
      </section>

      <section className="admin-section">
        <h2>Status history</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>From</th>
              <th>To</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={i}>
                <td>{h.previous_status ?? '—'}</td>
                <td>{h.new_status}</td>
                <td>{new Date(h.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <h2>Admin actions</h2>
        <p className="admin-muted">
          Sets the status directly via transition_order_status() — the fixed state-machine graph is still enforced;
          an invalid transition will show an error below rather than silently doing nothing.
        </p>
        <form action={async (formData: FormData) => {
          'use server';
          await setOrderStatus(id, String(formData.get('status')));
        }} className="admin-form-row">
          <select className="admin-select" name="status" defaultValue={order.status}>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <button className="admin-btn" type="submit">
            Set status
          </button>
        </form>

        {hasSucceededPayment && (
          <form
            action={async () => {
              'use server';
              await issueRefund(id, null);
            }}
          >
            <button className="admin-btn admin-btn-danger" type="submit">
              Issue full refund
            </button>
          </form>
        )}
        {!hasSucceededPayment && <p className="admin-muted">No unrefunded succeeded payment to refund.</p>}
      </section>
    </main>
  );
}
