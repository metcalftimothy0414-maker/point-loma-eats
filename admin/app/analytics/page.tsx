import { supabaseAdmin } from '../../lib/supabase-admin';

export const dynamic = 'force-dynamic';

// Point Loma Eats operates in exactly one timezone today (see 0005's cron
// schedule comment) — hardcoding it here is what makes "peak ordering
// hour" mean something. Bucketing by UTC hour instead would just measure
// whatever timezone the server happens to run in.
const INSTALLATION_TIMEZONE = 'America/Los_Angeles';

const hourFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: INSTALLATION_TIMEZONE,
  hour: 'numeric',
  hour12: false,
});

function localHour(isoString: string): number {
  // en-US 24-hour formatting can render midnight as "24" — normalize to 0.
  return Number(hourFormatter.format(new Date(isoString))) % 24;
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const params = await searchParams;
  const { from: defaultFrom, to: defaultTo } = defaultRange();
  const from = params.from || defaultFrom;
  // Include the full "to" day, not just its midnight.
  const toExclusive = new Date(`${params.to || defaultTo}T00:00:00.000Z`);
  toExclusive.setUTCDate(toExclusive.getUTCDate() + 1);

  const supabase = supabaseAdmin();

  const [ordersRes, customersRes, newCustomersRes] = await Promise.all([
    supabase
      .from('orders')
      .select('id, restaurant_id, delivery_point_id, customer_id, status, customer_total, tip_amount, food_cost, created_at')
      .gte('created_at', `${from}T00:00:00.000Z`)
      .lt('created_at', toExclusive.toISOString()),
    supabase.from('profiles').select('id').eq('role', 'customer'),
    supabase
      .from('profiles')
      .select('id')
      .eq('role', 'customer')
      .gte('created_at', `${from}T00:00:00.000Z`)
      .lt('created_at', toExclusive.toISOString()),
  ]);

  const ordersInRange = ordersRes.data ?? [];
  const orderIds = ordersInRange.map((o) => o.id);
  const delivered = ordersInRange.filter((o) => o.status === 'DELIVERED');
  const cancelled = ordersInRange.filter((o) => o.status === 'CANCELLED');

  // Repeat-customer rate needs LIFETIME order counts (someone who ordered
  // 3 times last year and once in this range is still a repeat customer),
  // scoped down to just the customers who ordered within this range.
  const [allOrdersRes, paymentsRes, historyRes, restaurantsRes, deliveryPointsRes] = await Promise.all([
    supabase.from('orders').select('customer_id'),
    orderIds.length
      ? supabase.from('payments').select('order_id, processing_fee').in('order_id', orderIds)
      : Promise.resolve({ data: [] as { order_id: string; processing_fee: number | null }[] }),
    delivered.length
      ? supabase
          .from('order_status_history')
          .select('order_id, new_status, created_at')
          .in('order_id', delivered.map((o) => o.id))
          .in('new_status', ['COURIER_ACCEPTED', 'DELIVERED'])
      : Promise.resolve({ data: [] as { order_id: string; new_status: string; created_at: string }[] }),
    supabase.from('restaurants').select('id, name'),
    supabase.from('delivery_points').select('id, name'),
  ]);

  const lifetimeOrderCountByCustomer = new Map<string, number>();
  for (const o of allOrdersRes.data ?? []) {
    lifetimeOrderCountByCustomer.set(o.customer_id, (lifetimeOrderCountByCustomer.get(o.customer_id) ?? 0) + 1);
  }
  const customersInRange = new Set(ordersInRange.map((o) => o.customer_id));
  const repeatCustomersInRange = [...customersInRange].filter((id) => (lifetimeOrderCountByCustomer.get(id) ?? 0) > 1).length;

  const restaurantNameById = new Map((restaurantsRes.data ?? []).map((r) => [r.id, r.name]));
  const deliveryPointNameById = new Map((deliveryPointsRes.data ?? []).map((p) => [p.id, p.name]));

  const revenue = delivered.reduce((sum, o) => sum + o.customer_total, 0);
  const foodCost = delivered.reduce((sum, o) => sum + o.food_cost, 0);
  const grossMargin = revenue - foodCost;
  const processingFeesByOrder = new Map((paymentsRes.data ?? []).map((p) => [p.order_id, p.processing_fee]));
  const deliveredWithKnownFee = delivered.filter((o) => processingFeesByOrder.get(o.id) != null);
  const totalProcessingFees = deliveredWithKnownFee.reduce((sum, o) => sum + (processingFeesByOrder.get(o.id) ?? 0), 0);
  const contributionMargin = grossMargin - totalProcessingFees;

  const rangeDays = Math.max(1, (toExclusive.getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / (1000 * 60 * 60 * 24));

  // Same COURIER_ACCEPTED -> DELIVERED approach as the Dashboard (Phase 7),
  // just over the selected range instead of just today.
  const acceptedAtByOrder = new Map<string, number>();
  const deliveredAtByOrder = new Map<string, number>();
  for (const row of historyRes.data ?? []) {
    const t = new Date(row.created_at).getTime();
    if (row.new_status === 'COURIER_ACCEPTED') acceptedAtByOrder.set(row.order_id, t);
    if (row.new_status === 'DELIVERED') deliveredAtByOrder.set(row.order_id, t);
  }
  const deliveryDurations: number[] = [];
  for (const [orderId, deliveredAt] of deliveredAtByOrder) {
    const acceptedAt = acceptedAtByOrder.get(orderId);
    if (acceptedAt !== undefined) deliveryDurations.push((deliveredAt - acceptedAt) / 1000 / 60);
  }
  const avgDeliveryMinutes =
    deliveryDurations.length > 0 ? deliveryDurations.reduce((sum, d) => sum + d, 0) / deliveryDurations.length : NaN;

  const restaurantStats = new Map<string, { count: number; revenue: number }>();
  for (const o of ordersInRange) {
    const stat = restaurantStats.get(o.restaurant_id) ?? { count: 0, revenue: 0 };
    stat.count += 1;
    if (o.status === 'DELIVERED') stat.revenue += o.customer_total;
    restaurantStats.set(o.restaurant_id, stat);
  }
  const topRestaurants = [...restaurantStats.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 10);

  const deliveryPointStats = new Map<string, number>();
  for (const o of ordersInRange) {
    deliveryPointStats.set(o.delivery_point_id, (deliveryPointStats.get(o.delivery_point_id) ?? 0) + 1);
  }
  const topDeliveryPoints = [...deliveryPointStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

  const ordersByHour = new Array(24).fill(0);
  for (const o of ordersInRange) {
    ordersByHour[localHour(o.created_at)] += 1;
  }
  const peakHour = ordersByHour.indexOf(Math.max(...ordersByHour));

  const stats = [
    { label: 'Orders', value: String(ordersInRange.length) },
    { label: 'Revenue (delivered)', value: `$${revenue.toFixed(2)}` },
    { label: 'Avg order value', value: delivered.length > 0 ? `$${(revenue / delivered.length).toFixed(2)}` : '—' },
    {
      label: 'Avg tip',
      value: ordersInRange.length > 0 ? `$${(ordersInRange.reduce((s, o) => s + o.tip_amount, 0) / ordersInRange.length).toFixed(2)}` : '—',
    },
    { label: 'Avg delivery time', value: Number.isFinite(avgDeliveryMinutes) ? `${Math.round(avgDeliveryMinutes)} min` : '—' },
    { label: 'Orders / day (avg)', value: (ordersInRange.length / rangeDays).toFixed(1) },
    { label: 'Revenue / day (avg)', value: `$${(revenue / rangeDays).toFixed(2)}` },
    { label: 'Cancellation rate', value: ordersInRange.length > 0 ? `${((cancelled.length / ordersInRange.length) * 100).toFixed(0)}%` : '—' },
    {
      label: 'Repeat customers (of active)',
      value: customersInRange.size > 0 ? `${repeatCustomersInRange} / ${customersInRange.size}` : '—',
    },
    { label: 'Total users (all-time)', value: String((customersRes.data ?? []).length) },
    { label: 'New users this range', value: String((newCustomersRes.data ?? []).length) },
  ];

  return (
    <main className="admin-main">
      <h1>Analytics</h1>

      <form className="admin-form-row">
        <label>
          From <input className="admin-input" type="date" name="from" defaultValue={from} />
        </label>
        <label>
          To <input className="admin-input" type="date" name="to" defaultValue={params.to || defaultTo} />
        </label>
        <button className="admin-btn" type="submit">
          Update
        </button>
      </form>

      <div className="admin-stats-row">
        {stats.map((s) => (
          <div key={s.label} className="admin-stat-box">
            <div className="admin-stat-value">{s.value}</div>
            <div className="admin-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <section className="admin-section">
        <h2>Margin</h2>
        <div className="admin-stats-row">
          <div className="admin-stat-box">
            <div className="admin-stat-value">${grossMargin.toFixed(2)}</div>
            <div className="admin-stat-label">Gross margin (revenue − food cost)</div>
          </div>
          <div className="admin-stat-box">
            <div className="admin-stat-value">${contributionMargin.toFixed(2)}</div>
            <div className="admin-stat-label">
              Contribution margin (− processing fees, {deliveredWithKnownFee.length}/{delivered.length} orders with a
              known fee)
            </div>
          </div>
        </div>
        <p className="admin-muted">
          Does not net out estimated vehicle/gas cost — there&apos;s no real input for that anywhere in this system,
          and approximating it would produce a more confident-looking number than the data actually supports.
          Customer acquisition cost isn&apos;t shown for the same reason: nothing here tracks marketing/ad spend, so
          there&apos;s no real number to compute it from.
        </p>
      </section>

      <section className="admin-section">
        <h2>Most popular restaurants</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Restaurant</th>
              <th>Orders</th>
              <th>Revenue (delivered)</th>
            </tr>
          </thead>
          <tbody>
            {topRestaurants.map(([id, stat]) => (
              <tr key={id}>
                <td>{restaurantNameById.get(id) ?? '—'}</td>
                <td>{stat.count}</td>
                <td>${stat.revenue.toFixed(2)}</td>
              </tr>
            ))}
            {topRestaurants.length === 0 && (
              <tr>
                <td colSpan={3}>No orders in this range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <h2>Most popular delivery points</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Delivery point</th>
              <th>Orders</th>
            </tr>
          </thead>
          <tbody>
            {topDeliveryPoints.map(([id, count]) => (
              <tr key={id}>
                <td>{deliveryPointNameById.get(id) ?? '—'}</td>
                <td>{count}</td>
              </tr>
            ))}
            {topDeliveryPoints.length === 0 && (
              <tr>
                <td colSpan={2}>No orders in this range.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <h2>Orders by hour of day ({INSTALLATION_TIMEZONE})</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Hour</th>
              <th>Orders</th>
            </tr>
          </thead>
          <tbody>
            {ordersByHour.map((count, hour) => (
              <tr key={hour}>
                <td>
                  {String(hour).padStart(2, '0')}:00{hour === peakHour && count > 0 ? ' — peak' : ''}
                </td>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
