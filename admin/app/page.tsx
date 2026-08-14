import { supabaseAdmin } from '../lib/supabase-admin';

export const dynamic = 'force-dynamic';

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return '—';
  return `${Math.round(minutes)} min`;
}

export default async function DashboardPage() {
  const supabase = supabaseAdmin();
  const todayStart = startOfToday();

  const [todayOrdersRes, allOrdersRes] = await Promise.all([
    supabase.from('orders').select('id, status, customer_total, tip_amount, created_at').gte('created_at', todayStart),
    // Lifetime, for repeat-customer rate — deliberately not scoped to today.
    supabase.from('orders').select('customer_id'),
  ]);

  const todayOrders = todayOrdersRes.data ?? [];
  const allOrders = allOrdersRes.data ?? [];

  const delivered = todayOrders.filter((o) => o.status === 'DELIVERED');
  const cancelled = todayOrders.filter((o) => o.status === 'CANCELLED');
  const revenue = delivered.reduce((sum, o) => sum + o.customer_total, 0);
  const avgOrderValue = delivered.length > 0 ? revenue / delivered.length : 0;
  const avgTip = todayOrders.length > 0 ? todayOrders.reduce((sum, o) => sum + o.tip_amount, 0) / todayOrders.length : 0;

  // "Per hour so far today" — wall-clock hours since midnight, not hours
  // anyone worked (that needs real time tracking; see the courier
  // dashboard, which deliberately doesn't show this for that reason). This
  // is a different, legitimately-computable metric: order velocity across
  // the business day, not a specific person's hours.
  const hoursSinceMidnight = Math.max(1, (Date.now() - new Date(todayStart).getTime()) / 1000 / 60 / 60);
  const ordersPerHour = todayOrders.length / hoursSinceMidnight;
  const revenuePerHour = revenue / hoursSinceMidnight;

  const customerOrderCounts = new Map<string, number>();
  for (const o of allOrders) {
    customerOrderCounts.set(o.customer_id, (customerOrderCounts.get(o.customer_id) ?? 0) + 1);
  }
  const totalCustomers = customerOrderCounts.size;
  const repeatCustomers = [...customerOrderCounts.values()].filter((count) => count > 1).length;

  // Average delivery time: COURIER_ACCEPTED -> DELIVERED, averaged across
  // today's delivered orders. Fetched separately since it needs
  // order_status_history, not just orders.
  let avgDeliveryMinutes = NaN;
  if (delivered.length > 0) {
    const { data: historyRows } = await supabase
      .from('order_status_history')
      .select('order_id, new_status, created_at')
      .in('order_id', delivered.map((o) => o.id))
      .in('new_status', ['COURIER_ACCEPTED', 'DELIVERED']);

    const acceptedAtByOrder = new Map<string, number>();
    const deliveredAtByOrder = new Map<string, number>();
    for (const row of historyRows ?? []) {
      const t = new Date(row.created_at).getTime();
      if (row.new_status === 'COURIER_ACCEPTED') acceptedAtByOrder.set(row.order_id, t);
      if (row.new_status === 'DELIVERED') deliveredAtByOrder.set(row.order_id, t);
    }

    const durations: number[] = [];
    for (const [orderId, deliveredAt] of deliveredAtByOrder) {
      const acceptedAt = acceptedAtByOrder.get(orderId);
      if (acceptedAt !== undefined) durations.push((deliveredAt - acceptedAt) / 1000 / 60);
    }
    if (durations.length > 0) {
      avgDeliveryMinutes = durations.reduce((sum, d) => sum + d, 0) / durations.length;
    }
  }

  const stats = [
    { label: "Today's orders", value: String(todayOrders.length) },
    { label: "Today's revenue", value: `$${revenue.toFixed(2)}` },
    { label: 'Average order value', value: `$${avgOrderValue.toFixed(2)}` },
    { label: 'Average tip', value: `$${avgTip.toFixed(2)}` },
    { label: 'Average delivery time', value: formatDuration(avgDeliveryMinutes) },
    { label: 'Orders / hour (today)', value: ordersPerHour.toFixed(1) },
    { label: 'Revenue / hour (today)', value: `$${revenuePerHour.toFixed(2)}` },
    {
      label: 'Repeat customers',
      value: totalCustomers > 0 ? `${repeatCustomers} / ${totalCustomers} (${((repeatCustomers / totalCustomers) * 100).toFixed(0)}%)` : '—',
    },
    { label: "Today's cancellations", value: String(cancelled.length) },
  ];

  return (
    <main className="admin-main">
      <h1>Dashboard</h1>
      <p className="admin-muted">
        Deeper analytics (most popular restaurant/delivery point, peak ordering hour, contribution margin trends,
        customer acquisition cost) are a separate later phase — this is the day-to-day operational view.
      </p>

      <div className="admin-stats-row">
        {stats.map((s) => (
          <div key={s.label} className="admin-stat-box">
            <div className="admin-stat-value">{s.value}</div>
            <div className="admin-stat-label">{s.label}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
