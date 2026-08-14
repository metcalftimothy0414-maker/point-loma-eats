import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStripe } from '@stripe/stripe-react-native';
import { useCart } from '../lib/cart';
import { supabase } from '../lib/supabase';

type DeliveryPoint = { id: string; name: string; zoneName: string };

type CreatePaymentIntentResponse = {
  order_id: string;
  client_secret: string;
  customer_total: number;
  error?: string;
};

export default function Checkout() {
  const { items, subtotal, restaurantId, restaurantName, clear } = useCart();
  const { initPaymentSheet, presentPaymentSheet } = useStripe();

  const [deliveryPoints, setDeliveryPoints] = useState<DeliveryPoint[] | null>(null);
  const [selectedDeliveryPointId, setSelectedDeliveryPointId] = useState<string | null>(null);
  const [tip, setTip] = useState('0');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Two queries + join in JS rather than a nested Supabase select — keeps
    // the shape predictable instead of guessing whether a to-one embed
    // comes back as an object or a single-element array.
    (async () => {
      const [pointsRes, zonesRes] = await Promise.all([
        supabase.from('delivery_points').select('id, name, zone_id').eq('is_active', true),
        supabase.from('delivery_zones').select('id, name'),
      ]);

      if (pointsRes.error || zonesRes.error) {
        setError((pointsRes.error ?? zonesRes.error)?.message ?? 'failed to load delivery points');
        return;
      }

      const zoneNameById = new Map((zonesRes.data ?? []).map((z) => [z.id, z.name]));
      const points = (pointsRes.data ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        zoneName: zoneNameById.get(p.zone_id) ?? '',
      }));

      setDeliveryPoints(points);
      if (points.length > 0) setSelectedDeliveryPointId(points[0].id);
    })();
  }, []);

  const tipAmount = Number(tip) || 0;
  const estimatedTotal = subtotal + tipAmount;

  async function handlePlaceOrder() {
    if (!restaurantId || !selectedDeliveryPointId) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const { data, error: invokeError } = await supabase.functions.invoke<CreatePaymentIntentResponse>(
        'create-payment-intent',
        {
          body: {
            restaurant_id: restaurantId,
            delivery_point_id: selectedDeliveryPointId,
            items: items.map((item) => ({ menu_item_id: item.menuItemId, quantity: item.qty })),
            tip_amount: tipAmount,
          },
        }
      );

      if (invokeError || !data?.client_secret) {
        throw new Error(data?.error ?? invokeError?.message ?? 'checkout failed');
      }

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'Point Loma Eats',
        paymentIntentClientSecret: data.client_secret,
      });
      if (initError) throw new Error(initError.message);

      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        // A user-initiated cancel isn't an error to show — anything else is.
        if (presentError.code !== 'Canceled') setError(presentError.message);
        setIsSubmitting(false);
        return;
      }

      clear();
      router.replace(`/order/${data.order_id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'checkout failed');
      setIsSubmitting(false);
    }
  }

  if (items.length === 0) {
    return (
      <View style={styles.centered}>
        <Text>Your cart is empty.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.sectionTitle}>{restaurantName}</Text>
      {items.map((item) => (
        <View key={item.menuItemId} style={styles.row}>
          <Text>
            {item.name} × {item.qty}
          </Text>
          <Text>${(item.displayPrice * item.qty).toFixed(2)}</Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>Where should we meet?</Text>
      {!deliveryPoints && <ActivityIndicator />}
      {deliveryPoints?.length === 0 && <Text style={styles.body}>No approved delivery points configured yet.</Text>}
      {deliveryPoints?.map((dp) => (
        <Pressable
          key={dp.id}
          style={[styles.option, selectedDeliveryPointId === dp.id && styles.optionSelected]}
          onPress={() => setSelectedDeliveryPointId(dp.id)}
        >
          <Text>
            {dp.zoneName ? `${dp.zoneName} — ` : ''}
            {dp.name}
          </Text>
        </Pressable>
      ))}

      <Text style={styles.sectionTitle}>Tip</Text>
      <TextInput style={styles.input} keyboardType="decimal-pad" value={tip} onChangeText={setTip} placeholder="0.00" />

      <View style={styles.summary}>
        <Text>Subtotal: ${subtotal.toFixed(2)}</Text>
        <Text>Tip: ${tipAmount.toFixed(2)}</Text>
        <Text style={styles.total}>Estimated total: ${estimatedTotal.toFixed(2)}</Text>
        <Text style={styles.disclaimer}>
          Estimated — the confirmed total (including any order minimum) is set at payment.
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable
        style={[styles.payButton, (!selectedDeliveryPointId || isSubmitting) && styles.payButtonDisabled]}
        disabled={!selectedDeliveryPointId || isSubmitting}
        onPress={handlePlaceOrder}
      >
        <Text style={styles.payButtonText}>{isSubmitting ? 'Processing…' : 'Pay & place order'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 8, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  body: { fontSize: 14, color: '#666' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  option: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, marginBottom: 8 },
  optionSelected: { borderColor: '#111', borderWidth: 2 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, fontSize: 16 },
  summary: { marginTop: 24, gap: 4 },
  total: { fontSize: 18, fontWeight: '700', marginTop: 4 },
  disclaimer: { fontSize: 12, color: '#888' },
  error: { color: '#c0392b', marginTop: 12 },
  payButton: { backgroundColor: '#111', borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 20 },
  payButtonDisabled: { backgroundColor: '#ccc' },
  payButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
