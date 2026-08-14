import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@^22';

interface RefundRequest {
  order_id: string;
  /** Dollars. Omit for a full refund of whatever's left unrefunded. */
  amount?: number;
  reason?: string;
}

let stripe: Stripe | undefined;
function getStripe(): Stripe {
  if (!stripe) stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!);
  return stripe;
}

let supabase: SupabaseClient | undefined;
function getSupabase(): SupabaseClient {
  if (!supabase) supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  return supabase;
}

Deno.serve(async (req) => {
  // Admin-only: called from the admin app's server action, never directly
  // by a customer or courier client — refunds are an admin decision
  // (brief section 22), not something either side can trigger on their own.
  const secret = Deno.env.get('ADMIN_ACTION_SECRET');
  if (secret && req.headers.get('x-admin-secret') !== secret) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  let body: RefundRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400);
  }

  const db = getSupabase();

  const { data: order, error: orderError } = await db.from('orders').select('status').eq('id', body.order_id).single();
  if (orderError || !order) {
    return jsonResponse({ error: 'order not found' }, 404);
  }

  // Only a payment that actually succeeded has anything to refund — an
  // order that never got past PAYMENT_PENDING (payment failed, or was
  // abandoned) has no succeeded payment row, so this naturally can't be
  // used to "refund" something that was never charged.
  const { data: payment, error: paymentError } = await db
    .from('payments')
    .select('id, stripe_payment_intent_id')
    .eq('order_id', body.order_id)
    .eq('status', 'succeeded')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (paymentError || !payment) {
    return jsonResponse({ error: 'no succeeded payment found for this order' }, 404);
  }

  let refund: Stripe.Refund;
  try {
    refund = await getStripe().refunds.create({
      payment_intent: payment.stripe_payment_intent_id,
      amount: body.amount ? Math.round(body.amount * 100) : undefined,
      reason: 'requested_by_customer',
    });
  } catch (err) {
    // Stripe itself is the safety net against e.g. refunding more than
    // was charged, or refunding an already-fully-refunded payment — its
    // error message is surfaced as-is rather than re-validated here.
    return jsonResponse({ error: `Stripe refund failed: ${err instanceof Error ? err.message : String(err)}` }, 502);
  }

  const refundedAmount = (refund.amount ?? 0) / 100;
  const { error: updateError } = await db.from('payments').update({ refunded_amount: refundedAmount }).eq('id', payment.id);
  if (updateError) return jsonResponse({ error: updateError.message }, 500);

  // REFUND_PENDING -> REFUNDED needs the intermediate hop if the order
  // isn't already there; transition_order_status() validates each step
  // against the fixed graph regardless of who's calling (here: service
  // role, which is exactly what the graph's "admin/service-role only"
  // authorization for this transition expects).
  if (order.status !== 'REFUND_PENDING') {
    const { error: pendingError } = await db.rpc('transition_order_status', {
      p_order_id: body.order_id,
      p_new_status: 'REFUND_PENDING',
      p_metadata: { reason: body.reason ?? null },
    });
    if (pendingError) return jsonResponse({ error: pendingError.message }, 500);
  }

  const { error: refundedError } = await db.rpc('transition_order_status', {
    p_order_id: body.order_id,
    p_new_status: 'REFUNDED',
    p_metadata: { stripe_refund_id: refund.id, refunded_amount: refundedAmount },
  });
  if (refundedError) return jsonResponse({ error: refundedError.message }, 500);

  return jsonResponse({ refund_id: refund.id, refunded_amount: refundedAmount });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
