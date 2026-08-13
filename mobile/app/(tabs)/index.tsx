import { StyleSheet, Text, View } from 'react-native';

export default function Home() {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>POINT LOMA</Text>
      <Text style={styles.headline}>What's for dinner?</Text>
      <Text style={styles.body}>
        Restaurants are coming soon. This screen will list nearby off-base restaurants once menus
        are loaded (Phase 3).
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, paddingTop: 80, backgroundColor: '#fff' },
  eyebrow: { fontSize: 13, fontWeight: '700', letterSpacing: 1.5, color: '#888' },
  headline: { fontSize: 32, fontWeight: '700', marginTop: 8, marginBottom: 16 },
  body: { fontSize: 15, color: '#666', lineHeight: 22 },
});
