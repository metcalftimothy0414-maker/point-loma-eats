import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StripeProvider } from '@stripe/stripe-react-native';
import { AuthProvider } from '../lib/auth';
import { CartProvider } from '../lib/cart';

const stripePublishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;

export default function RootLayout() {
  if (!stripePublishableKey) {
    throw new Error(
      'Missing EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY. Copy .env.example to .env and fill in your Stripe publishable key.'
    );
  }

  return (
    <StripeProvider publishableKey={stripePublishableKey}>
      <AuthProvider>
        <CartProvider>
          <Stack>
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="(auth)" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="restaurant/[id]" options={{ title: 'Menu' }} />
            <Stack.Screen name="checkout" options={{ title: 'Checkout' }} />
            <Stack.Screen name="order/[id]" options={{ title: 'Order' }} />
          </Stack>
          <StatusBar style="auto" />
        </CartProvider>
      </AuthProvider>
    </StripeProvider>
  );
}
