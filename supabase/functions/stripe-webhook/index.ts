import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';

// Service role only — a webhook has no user JWT, and every write it makes
// (payments status, order transitions) is exactly the kind of system-only
// action transition_order_status() restricts to admin/service_role.
const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

Deno.serve(async (req) => {
  const signature = req.headers.get('stripe-signature');
  if (!signature) {
    return new Response('missing stripe-signature header', { status: 400 });
  }

  // Signature verification needs the exact raw body — read as text before
  // anything touches it, never JSON.parse first and re-stringify.
  const rawBody = await req.text();

  let event: Stripe.Event;
  try {
    // constructEventAsync (not the sync constructEvent) — Deno's runtime
    // doesn't have Node's synchronous crypto, this variant uses Web Crypto
    // instead. This is the actual signature check; nothing past this
    // point trusts the request body until it passes.
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret);
  } catch (err) {
    return new Response(`signature verification failed: ${err instanceof Error ? err.message : String(err)}`, {
      status: 400,
    });
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handleSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await handleFailed(event.data.object as Stripe.PaymentIntent);
        break;
      default:
        // Not every event type needs handling here — Stripe sends far
        // more than payment_intent.*. Acknowledging with 200 for anything
        // unhandled is correct: it tells Stripe not to retry, and there's
        // nothing to log an "error" about for an event we never wanted.
        break;
    }
  } catch (err) {
    // A genuinely unexpected failure (DB down, etc.) — return non-2xx so
    // Stripe retries. Idempotency for the *expected* retry case (the same
    // event delivered twice) is handled inside handleSucceeded/handleFailed
    // themselves, not here.
    console.error(`webhook handling failed for ${event.type} (${event.id}):`, err);
    return new Response('internal error', { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});

async function handleSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const orderId = paymentIntent.metadata.order_id;
  if (!orderId) {
    console.error(`payment_intent ${paymentIntent.id} has no order_id in metadata`);
    return;
  }

  const { data: payment } = await supabase
    .from('payments')
    .select('status')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .single();

  // Stripe retries webhooks; the same succeeded event can arrive more than
  // once. If we've already recorded this as succeeded, this is a replay —
  // skip re-transitioning (PAID -> PAID isn't a valid transition and would
  // otherwise throw) rather than treating a retry as an error.
  if (payment?.status === 'succeeded') return;

  await supabase.from('payments').update({ status: 'succeeded' }).eq('stripe_payment_intent_id', paymentIntent.id);

  const { error: transitionError } = await supabase.rpc('transition_order_status', {
    p_order_id: orderId,
    p_new_status: 'PAID',
  });
  if (transitionError) throw transitionError;

  const { error: confirmError } = await supabase.rpc('confirm_and_assign_order', { p_order_id: orderId });
  if (confirmError) throw confirmError;
}

async function handleFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const orderId = paymentIntent.metadata.order_id;
  if (!orderId) {
    console.error(`payment_intent ${paymentIntent.id} has no order_id in metadata`);
    return;
  }

  const { data: payment } = await supabase
    .from('payments')
    .select('status')
    .eq('stripe_payment_intent_id', paymentIntent.id)
    .single();
  if (payment?.status === 'failed') return; // already handled, same idempotency reasoning as handleSucceeded

  await supabase.from('payments').update({ status: 'failed' }).eq('stripe_payment_intent_id', paymentIntent.id);

  const { data: order } = await supabase.from('orders').select('status').eq('id', orderId).single();
  // Only cancel from PAYMENT_PENDING — if the order's already moved past
  // that (e.g. a stray/duplicate failure event arriving after a separate
  // successful payment somehow went through), forcing CANCELLED here would
  // stomp on a real paid order instead of a failed attempt.
  if (order?.status !== 'PAYMENT_PENDING') return;

  const { error: transitionError } = await supabase.rpc('transition_order_status', {
    p_order_id: orderId,
    p_new_status: 'CANCELLED',
    p_metadata: { reason: 'payment_failed', stripe_payment_intent_id: paymentIntent.id },
  });
  if (transitionError) throw transitionError;
}
