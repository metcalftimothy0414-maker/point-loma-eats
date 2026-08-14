import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../lib/auth';

export default function CourierLayout() {
  const { session, profile, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!session) {
    return <Redirect href="/(auth)/sign-in" />;
  }

  // A customer/admin account landing here (typed URL, stale link) gets
  // sent back to the customer app rather than seeing an empty courier
  // dashboard — this app has no multi-role switcher; one account is one
  // role at a time (see README on promoting an account to courier).
  if (profile?.role !== 'courier') {
    return <Redirect href="/(tabs)" />;
  }

  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Deliveries', headerShown: false }} />
    </Stack>
  );
}
