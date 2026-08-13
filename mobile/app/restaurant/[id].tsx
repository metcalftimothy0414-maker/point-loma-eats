import { useEffect, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useCart } from '../../lib/cart';

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  display_price: number;
  category_id: string | null;
};

type Section = { title: string; data: MenuItem[] };

export default function RestaurantDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { addItem } = useCart();
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;

    (async () => {
      const [restaurantRes, categoriesRes, itemsRes] = await Promise.all([
        supabase.from('restaurants').select('name').eq('id', id).single(),
        supabase.from('menu_categories').select('id, name, sort_order').eq('restaurant_id', id).order('sort_order'),
        supabase
          .from('menu_items')
          .select('id, name, description, display_price, category_id')
          .eq('restaurant_id', id)
          .eq('is_available', true),
      ]);

      const fetchError = restaurantRes.error || categoriesRes.error || itemsRes.error;
      if (fetchError) {
        setError(fetchError.message);
        return;
      }

      setRestaurantName(restaurantRes.data?.name ?? null);

      const items = itemsRes.data ?? [];
      const categories = categoriesRes.data ?? [];
      const grouped = categories
        .map((category) => ({ title: category.name, data: items.filter((item) => item.category_id === category.id) }))
        .filter((section) => section.data.length > 0);
      const uncategorized = items.filter((item) => !item.category_id);

      setSections(uncategorized.length > 0 ? [...grouped, { title: 'Other', data: uncategorized }] : grouped);
    })();
  }, [id]);

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  if (!sections) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SectionList
      contentContainerStyle={styles.container}
      sections={sections}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={<Text style={styles.headline}>{restaurantName}</Text>}
      ListEmptyComponent={<Text style={styles.body}>No menu items yet.</Text>}
      renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
      renderItem={({ item }) => (
        <View style={styles.itemRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemName}>{item.name}</Text>
            {item.description ? <Text style={styles.itemDescription}>{item.description}</Text> : null}
            <Text style={styles.itemPrice}>${item.display_price.toFixed(2)}</Text>
          </View>
          <Pressable
            style={styles.addButton}
            onPress={() =>
              id &&
              restaurantName &&
              addItem(id, restaurantName, { menuItemId: item.id, name: item.name, displayPrice: item.display_price })
            }
          >
            <Text style={styles.addButtonText}>Add</Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, backgroundColor: '#fff' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  headline: { fontSize: 26, fontWeight: '700', marginBottom: 8 },
  body: { fontSize: 15, color: '#666', marginTop: 16 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    marginTop: 20,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  itemName: { fontSize: 16, fontWeight: '600' },
  itemDescription: { fontSize: 13, color: '#666', marginTop: 2 },
  itemPrice: { fontSize: 14, color: '#111', marginTop: 6, fontWeight: '600' },
  addButton: { backgroundColor: '#111', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, marginLeft: 12 },
  addButtonText: { color: '#fff', fontWeight: '600' },
  error: { color: '#c0392b' },
});
