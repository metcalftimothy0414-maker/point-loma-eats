import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCart } from '../../lib/cart';

export default function Cart() {
  const { items, subtotal, restaurantName, updateQty, clear } = useCart();

  if (items.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.headline}>Cart</Text>
        <Text style={styles.body}>Nothing here yet — add something from a restaurant.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.headline}>Cart</Text>
      <Text style={styles.restaurant}>{restaurantName}</Text>

      <FlatList
        data={items}
        keyExtractor={(item) => item.menuItemId}
        contentContainerStyle={{ paddingVertical: 12, gap: 12 }}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>
                ${item.displayPrice.toFixed(2)} × {item.qty}
              </Text>
            </View>
            <View style={styles.qtyControls}>
              <Pressable onPress={() => updateQty(item.menuItemId, item.qty - 1)} style={styles.qtyButton}>
                <Text style={styles.qtyButtonText}>−</Text>
              </Pressable>
              <Text style={styles.qty}>{item.qty}</Text>
              <Pressable onPress={() => updateQty(item.menuItemId, item.qty + 1)} style={styles.qtyButton}>
                <Text style={styles.qtyButtonText}>+</Text>
              </Pressable>
            </View>
          </View>
        )}
      />

      <View style={styles.footer}>
        <Text style={styles.subtotal}>Subtotal: ${subtotal.toFixed(2)}</Text>
        <Pressable style={styles.checkoutButton} disabled>
          <Text style={styles.checkoutButtonText}>Checkout — coming soon</Text>
        </Pressable>
        <Pressable onPress={clear}>
          <Text style={styles.clearLink}>Clear cart</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 80, backgroundColor: '#fff' },
  headline: { fontSize: 28, fontWeight: '700' },
  restaurant: { fontSize: 14, color: '#666', marginTop: 4 },
  body: { fontSize: 15, color: '#666', marginTop: 16 },
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f0f0f0', paddingBottom: 12 },
  itemName: { fontSize: 16, fontWeight: '600' },
  itemPrice: { fontSize: 13, color: '#666', marginTop: 2 },
  qtyControls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  qtyButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyButtonText: { fontSize: 16, fontWeight: '600' },
  qty: { fontSize: 15, fontWeight: '600', minWidth: 16, textAlign: 'center' },
  footer: { paddingTop: 16, borderTopWidth: 1, borderTopColor: '#eee' },
  subtotal: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  checkoutButton: { backgroundColor: '#ccc', borderRadius: 10, padding: 14, alignItems: 'center' },
  checkoutButtonText: { color: '#666', fontSize: 16, fontWeight: '600' },
  clearLink: { textAlign: 'center', color: '#c0392b', marginTop: 12 },
});
