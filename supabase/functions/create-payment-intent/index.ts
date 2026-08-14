import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';
import { corsHeaders } from '../_shared/cors.ts';

interface CheckoutRequest {
  restaurant_id: string;
  delivery_point_id: string;
  items: { menu_item_id: string; quantity: number }[];
  tip_amount?: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return jsonResponse({ error: 'missing Authorization header' }, 401);
  }

  let body: CheckoutRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Scoped to the calling user's own JWT, so create_order()'s auth.uid()
  // resolves to them — never a service-role call for this step, checkout
  // must only ever be able to create an order for yourself.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: orderResult, error: orderError } = await userClient
    .rpc('create_order', {
      p_restaurant_id: body.restaurant_id,
      p_delivery_point_id: body.delivery_point_id,
      p_items: body.items,
      p_tip_amount: body.tip_amount ?? 0,
    })
    .single();

  if (orderError || !orderResult) {
    // create_order()'s own error messages are already customer-safe
    // ("order subtotal is below the $X minimum", "menu item ... is not
    // available") — surfaced as-is rather than a generic failure.
    return jsonResponse({ error: orderError?.message ?? 'failed to create order' }, 400);
  }

  const { order_id, customer_total } = orderResult as { order_id: string; customer_total: number };

  // No explicit apiVersion pin — the SDK's own bundled default is safer
  // than guessing at a version string. Pin one deliberately if/when that
  // actually matters (a breaking Stripe API change affecting this code).
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);

  let paymentIntent: Stripe.PaymentIntent;
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(customer_total * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: { order_id },
    });
  } catch (err) {
    // The order row already exists (status CREATED) at this point. It's
    // left there rather than cleaned up — no payment was taken, so it's
    // an abandoned-cart row, not a corrupted one; the customer can just
    // retry checkout. Not building retry/idempotency handling for this
    // beyond that for V1.
    return jsonResponse({ error: `Stripe error: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  // Service role from here on: recording what Stripe created and moving
  // the order to PAYMENT_PENDING aren't actions the customer's own JWT is
  // authorized to take directly (see transition_order_status in
  // 0006_checkout.sql) — that's deliberate, so a client can't fake its way
  // into PAYMENT_PENDING without an actual PaymentIntent behind it.
  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { error: paymentInsertError } = await serviceClient.from('payments').insert({
    order_id,
    stripe_payment_intent_id: paymentIntent.id,
    amount: customer_total,
    currency: 'usd',
    status: paymentIntent.status,
  });
  if (paymentInsertError) {
    return jsonResponse({ error: `failed to record payment: ${paymentInsertError.message}` }, 500);
  }

  const { error: transitionError } = await serviceClient.rpc('transition_order_status', {
    p_order_id: order_id,
    p_new_status: 'PAYMENT_PENDING',
  });
  if (transitionError) {
    return jsonResponse({ error: `failed to transition order: ${transitionError.message}` }, 500);
  }

  return jsonResponse({ order_id, client_secret: paymentIntent.client_secret, customer_total });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
