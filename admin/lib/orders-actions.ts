'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from './supabase-admin';

/**
 * Calling transition_order_status() via this app's service-role client
 * satisfies its `v_is_service_role` check the same way the Stripe webhook
 * does — that's an intentional, already-documented part of the state
 * machine (0006_checkout.sql), not a new bypass. The transition graph
 * itself is still enforced: an invalid transition still throws here.
 */
export async function setOrderStatus(orderId: string, newStatus: string): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase.rpc('transition_order_status', {
    p_order_id: orderId,
    p_new_status: newStatus,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/orders');
}

export async function issueRefund(orderId: string, amount: number | null): Promise<void> {
  const refundUrl = process.env.REFUND_PAYMENT_URL;
  if (!refundUrl) {
    throw new Error('REFUND_PAYMENT_URL is not set — the refund-payment function has no known deployed address yet.');
  }
  const secret = process.env.ADMIN_ACTION_SECRET;

  const res = await fetch(refundUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-admin-secret': secret } : {}) },
    body: JSON.stringify({ order_id: orderId, amount: amount ?? undefined }),
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error ?? 'refund failed');

  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/refunds');
}
