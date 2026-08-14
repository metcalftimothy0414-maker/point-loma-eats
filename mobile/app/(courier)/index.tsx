import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';


type OrderStatus =
  | 'COURIER_ASSIGNED'
  | 'COURIER_ACCEPTED'
  | 'AT_RESTAURANT'
  | 'ORDER_PICKED_UP'
  | 'EN_ROUTE'
  | 'ON_INSTALLATION'
  | 'APPROACHING'
  | 'ARRIVED'
  | 'DELIVERED';

// The in-flight statuses a courier can act on — DELIVERED/CANCELLED/
// REFUND_PENDING/REFUNDED/DISPUTED are excluded: those are either done or
// admin-only from here (see 0006_checkout.sql's transition authorization).
const IN_FLIGHT_STATUSES: OrderStatus[] = [
  'COURIER_ASSIGNED',
  'COURIER_ACCEPTED',
  'AT_RESTAURANT',
  'ORDER_PICKED_UP',
  'EN_ROUTE',
  'ON_INSTALLATION',
  'APPROACHING',
  'ARRIVED',
];

const NEXT_ACTION: Record<OrderStatus, { label: string; next: OrderStatus } | null> = {
  COURIER_ASSIGNED: { label: 'ACCEPT', next: 'COURIER_ACCEPTED' },
  COURIER_ACCEPTED: { label: 'AT RESTAURANT', next: 'AT_RESTAURANT' },
  AT_RESTAURANT: { label: 'PICKED UP', next: 'ORDER_PICKED_UP' },
  ORDER_PICKED_UP: { label: 'ON THE WAY', next: 'EN_ROUTE' },
  EN_ROUTE: { label: 'ON INSTALLATION', next: 'ON_INSTALLATION' },
  ON_INSTALLATION: { label: 'APPROACHING', next: 'APPROACHING' },
  APPROACHING: { label: 'ARRIVED', next: 'ARRIVED' },
  ARRIVED: { label: 'DELIVERED', next: 'DELIVERED' },
  DELIVERED: null,
};

type OrderCard = {
  id: string;
  status: OrderStatus;
  customerTotal: number;
  tipAmount: number;
  restaurantName: string;
  customerName: string | null;
  customerPhone: string | null;
  deliveryPointName: string;
  deliveryPointInstructions: string | null;
  items: { name: string; quantity: number }[];
};

type TodayStats = { orderCount: number; revenue: number; avgOrderValue: number };

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function CourierDashboard() {
  const { profile } = useAuth();
  const [orders, setOrders] = useState<OrderCard[] | null>(null);
  const [stats, setStats] = useState<TodayStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!profile) return;
    setError(null);

    const { data: orderRows, error: ordersError } = await supabase
      .from('orders')
      .select('id, status, customer_total, tip_amount, restaurant_id, delivery_point_id, customer_id, created_at')
      .eq('courier_id', profile.id)
      .in('status', IN_FLIGHT_STATUSES)
      .order('created_at', { ascending: true });

    if (ordersError) {
      setError(ordersError.message);
      return;
    }

    const rows = orderRows ?? [];
    const orderIds = rows.map((o) => o.id);
    const restaurantIds = [...new Set(rows.map((o) => o.restaurant_id))];
    const deliveryPointIds = [...new Set(rows.map((o) => o.delivery_point_id))];
    const customerIds = [...new Set(rows.map((o) => o.customer_id))];

    const [itemsRes, restaurantsRes, deliveryPointsRes, customersRes] = await Promise.all([
      orderIds.length
        ? supabase.from('order_items').select('order_id, name, quantity').in('order_id', orderIds)
        : Promise.resolve({ data: [] as { order_id: string; name: string; quantity: number }[] }),
      restaurantIds.length
        ? supabase.from('restaurants').select('id, name').in('id', restaurantIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
      deliveryPointIds.length
        ? supabase.from('delivery_points').select('id, name, instructions').in('id', deliveryPointIds)
        : Promise.resolve({ data: [] as { id: string; name: string; instructions: string | null }[] }),
      customerIds.length
        ? supabase.from('profiles').select('id, full_name, phone').in('id', customerIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null; phone: string | null }[] }),
    ]);

    const restaurantNameById = new Map((restaurantsRes.data ?? []).map((r) => [r.id, r.name]));
    const deliveryPointById = new Map((deliveryPointsRes.data ?? []).map((d) => [d.id, d]));
    const customerById = new Map((customersRes.data ?? []).map((c) => [c.id, c]));
    const itemsByOrderId = new Map<string, { name: string; quantity: number }[]>();
    for (const item of itemsRes.data ?? []) {
      const list = itemsByOrderId.get(item.order_id) ?? [];
      list.push({ name: item.name, quantity: item.quantity });
      itemsByOrderId.set(item.order_id, list);
    }

    setOrders(
      rows.map((o) => {
        const dp = deliveryPointById.get(o.delivery_point_id);
        const customer = customerById.get(o.customer_id);
        return {
          id: o.id,
          status: o.status as OrderStatus,
          customerTotal: o.customer_total,
          tipAmount: o.tip_amount,
          restaurantName: restaurantNameById.get(o.restaurant_id) ?? 'Unknown restaurant',
          customerName: customer?.full_name ?? null,
          customerPhone: customer?.phone ?? null,
          deliveryPointName: dp?.name ?? 'Unknown delivery point',
          deliveryPointInstructions: dp?.instructions ?? null,
          items: itemsByOrderId.get(o.id) ?? [],
        };
      })
    );

    // Today's stats: a straightforward count/revenue/average from orders
    // created today. Deliberately not including "delivery hours worked" or
    // "revenue per hour" here — that needs real time-tracking (clock in/
    // out or similar), which doesn't exist yet; that's Phase 8 analytics,
    // not this operational dashboard. Showing a rough hours estimate from
    // order timestamps would be more misleading than useful.
    const { data: todayRows } = await supabase
      .from('orders')
      .select('status, customer_total')
      .eq('courier_id', profile.id)
      .gte('created_at', startOfToday());

    const delivered = (todayRows ?? []).filter((o) => o.status === 'DELIVERED');
    const revenue = delivered.reduce((sum, o) => sum + o.customer_total, 0);
    setStats({
      orderCount: (todayRows ?? []).length,
      revenue,
      avgOrderValue: delivered.length > 0 ? revenue / delivered.length : 0,
    });
  }, [profile]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRefresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

  async function handleAdvance(orderId: string, nextStatus: OrderStatus) {
    setUpdatingOrderId(orderId);
    const { error: transitionError } = await supabase.rpc('transition_order_status', {
      p_order_id: orderId,
      p_new_status: nextStatus,
    });
    if (transitionError) {
      setError(transitionError.message);
    }
    await load();
    setUpdatingOrderId(null);
  }

  if (!orders || !stats) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <FlatList
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} />}
      data={orders}
      keyExtractor={(order) => order.id}
      ListHeaderComponent={
        <View>
          <View style={styles.headerRow}>
            <Text style={styles.headline}>Deliveries</Text>
            <Pressable onPress={() => supabase.auth.signOut()}>
              <Text style={styles.signOutLink}>Sign out</Text>
            </Pressable>
          </View>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{stats.orderCount}</Text>
              <Text style={styles.statLabel}>Today's orders</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>${stats.revenue.toFixed(2)}</Text>
              <Text style={styles.statLabel}>Today's revenue</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>${stats.avgOrderValue.toFixed(2)}</Text>
              <Text style={styles.statLabel}>Avg order value</Text>
            </View>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      }
      ListEmptyComponent={<Text style={styles.body}>No active deliveries.</Text>}
      renderItem={({ item: order }) => {
        const action = NEXT_ACTION[order.status];
        return (
          <View style={styles.card}>
            <Text style={styles.restaurantName}>{order.restaurantName}</Text>
            <Text style={styles.cardLine}>
              {order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ') || 'No items recorded'}
            </Text>

            <View style={styles.divider} />

            <Text style={styles.cardLine}>Customer: {order.customerName ?? 'Unknown'}</Text>
            {order.customerPhone ? (
              <Pressable onPress={() => Linking.openURL(`tel:${order.customerPhone}`)}>
                <Text style={styles.link}>{order.customerPhone}</Text>
              </Pressable>
            ) : null}
            <Text style={styles.cardLine}>Meet at: {order.deliveryPointName}</Text>
            {order.deliveryPointInstructions ? (
              <Text style={styles.instructions}>{order.deliveryPointInstructions}</Text>
            ) : null}

            <View style={styles.divider} />

            <Text style={styles.cardLine}>
              Total ${order.customerTotal.toFixed(2)}
              {order.tipAmount > 0 ? ` (incl. $${order.tipAmount.toFixed(2)} tip)` : ''}
            </Text>

            {action ? (
              <Pressable
                style={styles.actionButton}
                disabled={updatingOrderId === order.id}
                onPress={() => handleAdvance(order.id, action.next)}
              >
                <Text style={styles.actionButtonText}>
                  {updatingOrderId === order.id ? 'Updating…' : action.label}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, gap: 12, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  headline: { fontSize: 26, fontWeight: '700' },
  signOutLink: { fontSize: 14, color: '#c0392b' },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statBox: { flex: 1, borderWidth: 1, borderColor: '#eee', borderRadius: 10, padding: 10, alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: '700' },
  statLabel: { fontSize: 11, color: '#666', marginTop: 2, textAlign: 'center' },
  body: { fontSize: 15, color: '#666' },
  error: { color: '#c0392b', marginBottom: 12 },
  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 16, marginBottom: 4 },
  restaurantName: { fontSize: 17, fontWeight: '700' },
  cardLine: { fontSize: 14, color: '#333', marginTop: 4 },
  instructions: { fontSize: 13, color: '#888', marginTop: 2, fontStyle: 'italic' },
  link: { fontSize: 14, color: '#0a58ca', marginTop: 2 },
  divider: { height: 1, backgroundColor: '#f0f0f0', marginVertical: 10 },
  actionButton: { backgroundColor: '#111', borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 12 },
  actionButtonText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.5 },
});
