import { useEffect, useState } from 'react';
import { router } from 'expo-router';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';

type Restaurant = {
  id: string;
  name: string;
  address: string;
  estimated_prep_minutes: number | null;
};

export default function Home() {
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from('restaurants')
      .select('id, name, address, estimated_prep_minutes')
      .eq('is_active', true)
      .order('name')
      .then(({ data, error: fetchError }) => {
        if (fetchError) setError(fetchError.message);
        else setRestaurants(data);
      });
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>POINT LOMA</Text>
      <Text style={styles.headline}>What's for dinner?</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {!restaurants && !error ? <ActivityIndicator style={{ marginTop: 24 }} /> : null}
      {restaurants?.length === 0 ? <Text style={styles.body}>No restaurants live yet.</Text> : null}

      <FlatList
        data={restaurants ?? []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ paddingTop: 16, gap: 12 }}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => router.push(`/restaurant/${item.id}`)}>
            <Text style={styles.cardName}>{item.name}</Text>
            <Text style={styles.cardMeta}>
              {item.address}
              {item.estimated_prep_minutes ? ` · ~${item.estimated_prep_minutes} min prep` : ''}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 80, backgroundColor: '#fff' },
  eyebrow: { fontSize: 13, fontWeight: '700', letterSpacing: 1.5, color: '#888' },
  headline: { fontSize: 32, fontWeight: '700', marginTop: 8 },
  body: { fontSize: 15, color: '#666', lineHeight: 22, marginTop: 16 },
  error: { color: '#c0392b', marginTop: 16 },
  card: { borderWidth: 1, borderColor: '#eee', borderRadius: 12, padding: 16 },
  cardName: { fontSize: 17, fontWeight: '600' },
  cardMeta: { fontSize: 13, color: '#666', marginTop: 4 },
});
