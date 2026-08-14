'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from './supabase-admin';

export async function createSupportTicket(formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const orderId = String(formData.get('order_id'));

  const { data: order, error: orderError } = await supabase.from('orders').select('customer_id').eq('id', orderId).single();
  if (orderError || !order) throw new Error(orderError?.message ?? 'order not found');

  const { error } = await supabase.from('support_tickets').insert({
    order_id: orderId,
    customer_id: order.customer_id,
    category: String(formData.get('category')),
    description: formData.get('description') ? String(formData.get('description')) : null,
  });
  if (error) throw new Error(error.message);

  revalidatePath('/support');
}

/**
 * resolved_by is deliberately left unset — this app has one shared Basic
 * Auth credential (lib/supabase-admin.ts), not per-admin sessions, so
 * there's no real identity to attribute a resolution to. Not faked.
 */
export async function resolveSupportTicket(ticketId: string, formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from('support_tickets')
    .update({
      status: 'RESOLVED',
      resolution_notes: formData.get('resolution_notes') ? String(formData.get('resolution_notes')) : null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', ticketId);
  if (error) throw new Error(error.message);

  revalidatePath('/support');
}
