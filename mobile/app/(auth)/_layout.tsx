import { Redirect, Slot } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../../lib/auth';

export default function AuthLayout() {
  const { session, profile, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (session) {
    return <Redirect href={profile?.role === 'courier' ? '/(courier)' : '/(tabs)'} />;
  }

  return <Slot />;
}
