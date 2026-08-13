import type { SupabaseClient } from '@supabase/supabase-js';
import type { ProposedChange } from './diff.ts';

export interface ApplyDecision {
  change: ProposedChange;
  status: 'auto_applied' | 'pending_review';
  reason: string;
}

const PRICE_INCREASE_AUTO_APPLY_THRESHOLD = 0.05; // 5%
const CONFIDENCE_AUTO_APPLY_THRESHOLD = 0.85;
const CHURN_QUEUE_THRESHOLD = 0.3; // 30%

/**
 * Decides auto_applied vs pending_review per the spec's rules. Three
 * conditions force EVERY change in the run to pending_review, regardless
 * of how safe any individual change looks on its own: low overall
 * confidence, high churn, and category restructuring. These are run-level
 * circuit breakers, not per-item exceptions — a parse that's mostly wrong
 * can still contain individually-plausible-looking price decreases, and a
 * bad parse costs real margin.
 */
export function decideChanges(
  changes: ProposedChange[],
  context: { runConfidence: number; totalExistingItems: number; categoryRestructured: boolean }
): ApplyDecision[] {
  const churnRate = context.totalExistingItems === 0 ? 0 : changes.length / context.totalExistingItems;

  const forceReviewReason =
    context.runConfidence < CONFIDENCE_AUTO_APPLY_THRESHOLD
      ? `run confidence ${context.runConfidence.toFixed(2)} < ${CONFIDENCE_AUTO_APPLY_THRESHOLD}`
      : churnRate > CHURN_QUEUE_THRESHOLD
        ? `${(churnRate * 100).toFixed(0)}% of items changed (> ${CHURN_QUEUE_THRESHOLD * 100}%)`
        : context.categoryRestructured
          ? 'category structure changed'
          : null;

  return changes.map((change) => {
    if (forceReviewReason) {
      return { change, status: 'pending_review', reason: forceReviewReason };
    }

    switch (change.changeType) {
      case 'new':
        return { change, status: 'auto_applied', reason: 'new item' };
      case 'availability':
        return { change, status: 'auto_applied', reason: 'availability change' };
      case 'delete':
        return { change, status: 'pending_review', reason: 'item deletion' };
      case 'price': {
        const { oldValue, newValue } = change;
        if (newValue.basePrice <= oldValue.basePrice) {
          return { change, status: 'auto_applied', reason: 'price decrease' };
        }
        const increasePct = (newValue.basePrice - oldValue.basePrice) / oldValue.basePrice;
        return increasePct <= PRICE_INCREASE_AUTO_APPLY_THRESHOLD
          ? { change, status: 'auto_applied', reason: `price increase ${(increasePct * 100).toFixed(1)}% <= 5%` }
          : { change, status: 'pending_review', reason: `price increase ${(increasePct * 100).toFixed(1)}% > 5%` };
      }
    }
  });
}

async function applyToMenuItems(supabase: SupabaseClient, restaurantId: string, change: ProposedChange): Promise<void> {
  const lastSyncedAt = new Date().toISOString();

  switch (change.changeType) {
    case 'new': {
      const { error } = await supabase.from('menu_items').insert({
        restaurant_id: restaurantId,
        name: change.newValue.name,
        description: change.newValue.description,
        // display_price is never written here — it's derived by the
        // menu_items_set_display_price trigger (0003) from base_price.
        base_price: change.newValue.basePrice,
        is_available: change.newValue.isAvailable,
        source_item_id: change.newValue.sourceItemId,
        sync_confidence: change.newValue.confidence,
        last_synced_at: lastSyncedAt,
      });
      if (error) throw error;
      return;
    }
    case 'price': {
      const { error } = await supabase
        .from('menu_items')
        .update({ base_price: change.newValue.basePrice, last_synced_at: lastSyncedAt })
        .eq('id', change.menuItemId)
        .eq('manual_override', false);
      if (error) throw error;
      return;
    }
    case 'availability': {
      const { error } = await supabase
        .from('menu_items')
        .update({ is_available: change.newValue.isAvailable, last_synced_at: lastSyncedAt })
        .eq('id', change.menuItemId)
        .eq('manual_override', false);
      if (error) throw error;
      return;
    }
    case 'delete':
      // decideChanges() never marks a delete as auto_applied — this branch
      // exists for switch exhaustiveness and as a tripwire: if a future
      // rule change ever lets a delete through, this throws immediately
      // instead of silently no-op'ing on what should have been an update.
      throw new Error('applyToMenuItems: a delete change reached auto-apply, which should be unreachable');
  }
}

/**
 * Writes every decision to menu_item_changes (the audit trail), applying
 * auto_applied ones to menu_items first — so a failed changes-row insert
 * never leaves a real menu_items write with no record of why it happened.
 * manual_override is re-checked here (`.eq('manual_override', false)`
 * above) even though callers are expected to have excluded those items
 * from the diff already — belt and suspenders on a path that costs real
 * margin if it's wrong.
 */
export async function persistDecisions(
  supabase: SupabaseClient,
  syncRunId: string,
  restaurantId: string,
  decisions: ApplyDecision[]
): Promise<void> {
  for (const { change, status } of decisions) {
    if (status === 'auto_applied') {
      await applyToMenuItems(supabase, restaurantId, change);
    }

    const { error } = await supabase.from('menu_item_changes').insert({
      sync_run_id: syncRunId,
      menu_item_id: change.menuItemId,
      change_type: change.changeType,
      old_value: 'oldValue' in change ? change.oldValue : null,
      new_value: 'newValue' in change ? change.newValue : null,
      confidence: change.confidence,
      status,
    });
    if (error) throw error;
  }
}
