'use server';

import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from './supabase-admin';

interface PendingChange {
  id: string;
  menu_item_id: string | null;
  change_type: 'price' | 'availability' | 'new' | 'delete';
  new_value: Record<string, unknown> | null;
  status: string;
  sync_run_id: string;
}

/**
 * Approving a change applies it to menu_items — same base_price/
 * is_available shape as services/menu-sync/apply.ts's auto-apply path.
 * Duplicated rather than imported: admin/ and services/menu-sync/ are
 * separate deployables with no shared package set up yet, and this is
 * small and stable enough that the duplication is cheaper than the
 * workspace plumbing it'd take to share it.
 */
async function applyApprovedChange(
  supabase: SupabaseClient,
  change: PendingChange,
  restaurantId: string | null
): Promise<void> {
  const lastSyncedAt = new Date().toISOString();

  switch (change.change_type) {
    case 'new': {
      if (!restaurantId) throw new Error('applyApprovedChange: "new" change is missing its restaurant id');
      const v = change.new_value as {
        name: string;
        description: string | null;
        basePrice: number;
        isAvailable: boolean;
        sourceItemId: string | null;
        confidence: number;
      } | null;
      if (!v) throw new Error('applyApprovedChange: "new" change has no new_value');
      const { error } = await supabase.from('menu_items').insert({
        restaurant_id: restaurantId,
        name: v.name,
        description: v.description,
        base_price: v.basePrice, // display_price stays trigger-derived, never written here
        is_available: v.isAvailable,
        source_item_id: v.sourceItemId,
        sync_confidence: v.confidence,
        last_synced_at: lastSyncedAt,
      });
      if (error) throw error;
      return;
    }
    case 'price': {
      const v = change.new_value as { basePrice: number } | null;
      if (!v || !change.menu_item_id) throw new Error('applyApprovedChange: price change missing menu_item_id/new_value');
      const { error } = await supabase
        .from('menu_items')
        .update({ base_price: v.basePrice, last_synced_at: lastSyncedAt })
        .eq('id', change.menu_item_id)
        .eq('manual_override', false);
      if (error) throw error;
      return;
    }
    case 'availability': {
      const v = change.new_value as { isAvailable: boolean } | null;
      if (!v || !change.menu_item_id) {
        throw new Error('applyApprovedChange: availability change missing menu_item_id/new_value');
      }
      const { error } = await supabase
        .from('menu_items')
        .update({ is_available: v.isAvailable, last_synced_at: lastSyncedAt })
        .eq('id', change.menu_item_id)
        .eq('manual_override', false);
      if (error) throw error;
      return;
    }
    case 'delete': {
      if (!change.menu_item_id) throw new Error('applyApprovedChange: delete change missing menu_item_id');
      // Soft-delete: mark unavailable rather than hard-deleting the row, so
      // approving a stale "this item is gone" suggestion stays reversible.
      const { error } = await supabase
        .from('menu_items')
        .update({ is_available: false, last_synced_at: lastSyncedAt })
        .eq('id', change.menu_item_id)
        .eq('manual_override', false);
      if (error) throw error;
      return;
    }
  }
}

export async function approveChange(changeId: string): Promise<void> {
  const supabase = supabaseAdmin();

  const { data: change, error } = await supabase
    .from('menu_item_changes')
    .select('id, menu_item_id, change_type, new_value, status, sync_run_id')
    .eq('id', changeId)
    .single();
  if (error) throw error;
  if (change.status !== 'pending_review') return;

  let restaurantId: string | null = null;
  if (change.change_type === 'new') {
    const { data: run, error: runError } = await supabase
      .from('menu_sync_runs')
      .select('restaurant_id')
      .eq('id', change.sync_run_id)
      .single();
    if (runError) throw runError;
    restaurantId = run.restaurant_id;
  }

  await applyApprovedChange(supabase, change as PendingChange, restaurantId);

  const { error: updateError } = await supabase
    .from('menu_item_changes')
    .update({ status: 'approved', reviewed_at: new Date().toISOString() })
    .eq('id', changeId);
  if (updateError) throw updateError;

  revalidatePath('/');
}

export async function rejectChange(changeId: string): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from('menu_item_changes')
    .update({ status: 'rejected', reviewed_at: new Date().toISOString() })
    .eq('id', changeId)
    .eq('status', 'pending_review');
  if (error) throw error;
  revalidatePath('/');
}

export async function bulkApprove(formData: FormData): Promise<void> {
  const ids = formData.getAll('changeId').map(String);
  for (const id of ids) {
    await approveChange(id);
  }
}

export async function triggerSync(restaurantId: string): Promise<void> {
  const triggerUrl = process.env.MENU_SYNC_TRIGGER_URL;
  if (!triggerUrl) {
    throw new Error('MENU_SYNC_TRIGGER_URL is not set — the menu-sync service has no known deployed address yet.');
  }
  const secret = process.env.MENU_SYNC_TRIGGER_SECRET;

  await fetch(`${triggerUrl}/${restaurantId}`, {
    method: 'POST',
    headers: secret ? { 'x-trigger-secret': secret } : undefined,
  });

  revalidatePath('/');
}
