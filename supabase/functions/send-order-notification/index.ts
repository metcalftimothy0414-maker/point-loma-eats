import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type OrderStatus =
  | 'CREATED'
  | 'PAYMENT_PENDING'
  | 'PAID'
  | 'CONFIRMED'
  | 'COURIER_ASSIGNED'
  | 'COURIER_ACCEPTED'
  | 'AT_RESTAURANT'
  | 'ORDER_PICKED_UP'
  | 'EN_ROUTE'
  | 'ON_INSTALLATION'
  | 'APPROACHING'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'DISPUTED';

interface NotificationContent {
  title: string;
  body: string;
}

// Matches the brief's customer notification list (section 20) almost
// exactly — CANCELLED is added on top of it: leaving a customer with no
// word that their order was cancelled would be worse than the list not
// being exhaustive here.
const CUSTOMER_NOTIFICATIONS: Partial<Record<OrderStatus, NotificationContent>> = {
  CONFIRMED: { title: 'Order confirmed', body: "We've got your order — it's being prepared." },
  ORDER_PICKED_UP: { title: 'Food picked up', body: 'Your food has been picked up and is on its way.' },
  EN_ROUTE: { title: 'Courier on the way', body: 'Your courier is on the way to Point Loma.' },
  APPROACHING: { title: 'Courier approaching', body: 'Your courier is almost at your delivery point.' },
  ARRIVED: { title: 'Courier arrived', body: 'Your courier has arrived — head to your delivery point.' },
  DELIVERED: { title: 'Order delivered', body: 'Enjoy! Your order has been delivered.' },
  REFUNDED: { title: 'Refund issued', body: 'Your refund has been issued.' },
  CANCELLED: { title: 'Order cancelled', body: 'Your order has been cancelled.' },
};

// Matches the brief's courier notification list (section 20) as far as
// this app can actually produce — "customer changed order" and "support
// message" aren't features that exist, so there's nothing to notify about
// for those.
const COURIER_NOTIFICATIONS: Partial<Record<OrderStatus, NotificationContent>> = {
  COURIER_ASSIGNED: { title: 'New order', body: 'A new order has been assigned to you.' },
  CANCELLED: { title: 'Order cancelled', body: 'One of your assigned orders was cancelled.' },
};

interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
}

/**
 * Pure decision logic, separated from the I/O (token lookup, Expo API
 * call) so it's testable without mocking Supabase/fetch. Courier content
 * only applies if the order actually has a courier assigned — a
 * CANCELLED order that never got past CONFIRMED has no one to notify on
 * the courier side.
 */
export function selectNotifications(
  newStatus: OrderStatus,
  hasCourier: boolean
): { customer: NotificationContent | null; courier: NotificationContent | null } {
  return {
    customer: CUSTOMER_NOTIFICATIONS[newStatus] ?? null,
    courier: hasCourier ? (COURIER_NOTIFICATIONS[newStatus] ?? null) : null,
  };
}

// Lazily constructed (not at module scope) so this file can be imported —
// e.g. for index.test.ts's pure selectNotifications() tests — without
// requiring env vars that only matter once a request actually comes in.
let supabase: SupabaseClient | undefined;
function getSupabase() {
  if (!supabase) {
    supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  }
  return supabase;
}

Deno.serve(async (req) => {
  // Called only by the order_status_history_notify trigger via pg_net
  // (0008_live_tracking_notifications.sql) — not a public webhook, so a
  // shared secret is enough (no user-facing signature scheme like Stripe's).
  const secret = Deno.env.get('NOTIFICATION_TRIGGER_SECRET');
  if (secret && req.headers.get('x-trigger-secret') !== secret) {
    return new Response('unauthorized', { status: 401 });
  }

  let body: { order_id: string; new_status: OrderStatus };
  try {
    body = await req.json();
  } catch {
    return new Response('invalid JSON body', { status: 400 });
  }

  const { data: order, error } = await getSupabase()
    .from('orders')
    .select('customer_id, courier_id')
    .eq('id', body.order_id)
    .single();

  if (error || !order) {
    // Not an error worth retrying over — logged for visibility, but the
    // trigger that called this is fire-and-forget regardless.
    console.error(`order ${body.order_id} not found`, error);
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const { customer: customerContent, courier: courierContent } = selectNotifications(
    body.new_status,
    order.courier_id !== null
  );

  const messages: ExpoMessage[] = [];

  if (customerContent) {
    const token = await getPushToken(order.customer_id);
    if (token) messages.push({ to: token, sound: 'default', ...customerContent });
  }

  if (courierContent && order.courier_id) {
    const token = await getPushToken(order.courier_id);
    if (token) messages.push({ to: token, sound: 'default', ...courierContent });
  }

  if (messages.length === 0) {
    // Most statuses (PAYMENT_PENDING, COURIER_ACCEPTED, ON_INSTALLATION,
    // ...) intentionally have no entry in either map above — this isn't a
    // failure, it's most calls to this function doing nothing on purpose.
    return new Response(JSON.stringify({ sent: 0 }), { status: 200 });
  }

  const expoRes = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });

  if (!expoRes.ok) {
    console.error('Expo push API error', await expoRes.text());
    return new Response('expo push failed', { status: 502 });
  }

  return new Response(JSON.stringify({ sent: messages.length }), { status: 200 });
});

async function getPushToken(profileId: string): Promise<string | null> {
  const { data } = await getSupabase().from('profiles').select('expo_push_token').eq('id', profileId).single();
  return data?.expo_push_token ?? null;
}
