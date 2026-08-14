import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';

type OrderItem = { id: string; name: string; unit_price: number; quantity: number; line_total: number };

type OrderDetail = {
  status: string;
  subtotal: number;
  tip_amount: number;
  customer_total: number;
  restaurant_id: string;
  delivery_point_id: string;
};

// Not live-updating yet (Phase 6: realtime order tracking) — this is a
// point-in-time confirmation screen, matching the brief's "receive an
// order confirmation" success criterion, not the full status-by-status
// tracking UI.
const STATUS_LABELS: Record<string, string> = {
  CREATED: 'Order created',
  PAYMENT_PENDING: 'Processing payment…',
  PAID: 'Payment confirmed',
  CONFIRMED: 'Order confirmed',
  COURIER_ASSIGNED: 'Food being picked up',
  COURIER_ACCEPTED: 'Food being picked up',
  AT_RESTAURANT: 'Food being picked up',
  ORDER_PICKED_UP: 'On the way',
  EN_ROUTE: 'On the way',
  ON_INSTALLATION: 'On installation',
  APPROACHING: 'Arriving',
  ARRIVED: 'Ready for pickup',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUND_PENDING: 'Refund pending',
  REFUNDED: 'Refunded',
  DISPUTED: 'Under review',
};

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [items, setItems] = useState<OrderItem[] | null>(null);
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [deliveryPointName, setDeliveryPointName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    (async () => {
      const { data: orderRow, error: orderError } = await supabase
        .from('orders')
        .select('status, subtotal, tip_amount, customer_total, restaurant_id, delivery_point_id')
        .eq('id', id)
        .single();

      if (orderError || !orderRow) {
        setError(orderError?.message ?? 'order not found');
        return;
      }
      setOrder(orderRow);

      const [itemsRes, restaurantRes, deliveryPointRes] = await Promise.all([
        supabase.from('order_items').select('id, name, unit_price, quantity, line_total').eq('order_id', id),
        supabase.from('restaurants').select('name').eq('id', orderRow.restaurant_id).single(),
        supabase.from('delivery_points').select('name').eq('id', orderRow.delivery_point_id).single(),
      ]);

      setItems(itemsRes.data ?? []);
      setRestaurantName(restaurantRes.data?.name ?? null);
      setDeliveryPointName(deliveryPointRes.data?.name ?? null);
    })();
  }, [id]);

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (!order || !items) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.status}>{STATUS_LABELS[order.status] ?? order.status}</Text>
      <Text style={styles.subtitle}>{restaurantName}</Text>
      <Text style={styles.subtitle}>Meet at: {deliveryPointName}</Text>

      <View style={styles.divider} />

      {items.map((item) => (
        <View key={item.id} style={styles.row}>
          <Text>
            {item.name} × {item.quantity}
          </Text>
          <Text>${item.line_total.toFixed(2)}</Text>
        </View>
      ))}

      <View style={styles.divider} />

      <View style={styles.row}>
        <Text>Subtotal</Text>
        <Text>${order.subtotal.toFixed(2)}</Text>
      </View>
      <View style={styles.row}>
        <Text>Tip</Text>
        <Text>${order.tip_amount.toFixed(2)}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalLabel}>${order.customer_total.toFixed(2)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 60, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  status: { fontSize: 24, fontWeight: '700' },
  subtitle: { fontSize: 14, color: '#666', marginTop: 4 },
  divider: { height: 1, backgroundColor: '#eee', marginVertical: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totalLabel: { fontWeight: '700', fontSize: 16 },
  error: { color: '#c0392b' },
});
