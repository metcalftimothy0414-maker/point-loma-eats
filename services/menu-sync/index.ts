import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { fetchForSync, FetchBlockedError } from './fetch.ts';
import { detectPlatform } from './detect.ts';
import { normalize } from './normalize.ts';
import { diffMenu, type ExistingMenuItem } from './diff.ts';
import { decideChanges, persistDecisions } from './apply.ts';
import * as toast from './adapters/toast.ts';
import * as square from './adapters/square.ts';
import * as clover from './adapters/clover.ts';
import * as chownow from './adapters/chownow.ts';
import * as generic from './adapters/generic.ts';
import type { AdapterRun, SourcePlatform } from './types.ts';

const STRUCTURED_ADAPTERS: Record<Exclude<SourcePlatform, 'generic'>, AdapterRun> = {
  toast: toast.run,
  square: square.run,
  clover: clover.run,
  chownow: chownow.run,
};

function supabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
  return createClient(url, serviceRoleKey);
}

interface RestaurantToSync {
  id: string;
  websiteUrl: string;
}

/**
 * Syncs one restaurant. Never throws — every outcome (success, blocked,
 * failed) is recorded as a menu_sync_runs row instead of bubbling up, so
 * one restaurant's failure can't take down the rest of a nightly batch.
 */
export async function syncRestaurant(supabase: SupabaseClient, restaurant: RestaurantToSync): Promise<void> {
  const startedAt = new Date().toISOString();
  let sourcePlatform: SourcePlatform = 'generic';

  try {
    const html = await fetchForSync(restaurant.websiteUrl);
    sourcePlatform = detectPlatform(restaurant.websiteUrl, html);

    const adapterResult =
      sourcePlatform === 'generic'
        ? await generic.run(restaurant.websiteUrl, html, 'html')
        : await STRUCTURED_ADAPTERS[sourcePlatform](restaurant.websiteUrl);

    const normalized = normalize(adapterResult, restaurant.id);

    const { data: existingRows, error: existingError } = await supabase
      .from('menu_items')
      .select('id, name, base_price, is_available, source_item_id, manual_override')
      .eq('restaurant_id', restaurant.id);
    if (existingError) throw existingError;

    // manual_override items are excluded here, once, so the rest of the
    // pipeline (diff, apply) never has to remember to skip them.
    const existing: ExistingMenuItem[] = (existingRows ?? [])
      .filter((row) => !row.manual_override)
      .map((row) => ({
        id: row.id,
        name: row.name,
        basePrice: Number(row.base_price),
        isAvailable: row.is_available,
        sourceItemId: row.source_item_id,
      }));

    const changes = diffMenu(normalized, existing);

    const { data: existingCategoryRows } = await supabase
      .from('menu_categories')
      .select('name')
      .eq('restaurant_id', restaurant.id);
    const currentCategoryNames = new Set((existingCategoryRows ?? []).map((c) => c.name.trim().toLowerCase()));
    const newCategoryNames = new Set(normalized.categories.map((c) => c.name.trim().toLowerCase()));
    const categoryRestructured =
      currentCategoryNames.size > 0 &&
      (currentCategoryNames.size !== newCategoryNames.size ||
        [...currentCategoryNames].some((name) => !newCategoryNames.has(name)));

    const decisions = decideChanges(changes, {
      runConfidence: normalized.confidence,
      totalExistingItems: existing.length,
      categoryRestructured,
    });

    const { data: run, error: runError } = await supabase
      .from('menu_sync_runs')
      .insert({
        restaurant_id: restaurant.id,
        source_platform: sourcePlatform,
        source_url: restaurant.websiteUrl,
        status: 'success',
        items_found: normalized.categories.flatMap((c) => c.items).length,
        items_changed: changes.length,
        started_at: startedAt,
        completed_at: new Date().toISOString(),
      })
      .select('id')
      .single();
    if (runError) throw runError;

    await persistDecisions(supabase, run.id, restaurant.id, decisions);

    await supabase
      .from('restaurants')
      .update({ sync_status: 'ok', last_sync_at: new Date().toISOString() })
      .eq('id', restaurant.id);
  } catch (err) {
    const status = err instanceof FetchBlockedError ? 'blocked' : 'failed';
    await supabase.from('menu_sync_runs').insert({
      restaurant_id: restaurant.id,
      source_platform: sourcePlatform,
      source_url: restaurant.websiteUrl,
      status,
      error: err instanceof Error ? err.message : String(err),
      started_at: startedAt,
      completed_at: new Date().toISOString(),
    });
    await disableIfThreeConsecutiveFailures(supabase, restaurant.id);
  }
}

/**
 * 3 consecutive failed/blocked runs -> sync_status = 'needs_attention',
 * stop retrying. Reads the last 3 rows from menu_sync_runs rather than
 * keeping a separate counter column, so run history stays the single
 * source of truth for "how is this restaurant's sync doing."
 */
async function disableIfThreeConsecutiveFailures(supabase: SupabaseClient, restaurantId: string): Promise<void> {
  const { data: recentRuns } = await supabase
    .from('menu_sync_runs')
    .select('status')
    .eq('restaurant_id', restaurantId)
    .order('started_at', { ascending: false })
    .limit(3);

  const rows = recentRuns ?? [];
  const lastThreeAllFailed = rows.length === 3 && rows.every((r) => r.status === 'failed' || r.status === 'blocked');

  if (lastThreeAllFailed) {
    await supabase.from('restaurants').update({ sync_status: 'needs_attention' }).eq('id', restaurantId);
  }
}

/** Syncs a single restaurant by id — the "sync now" admin action. */
export async function syncOneRestaurant(restaurantId: string): Promise<void> {
  const supabase = supabaseAdmin();
  const { data: restaurant, error } = await supabase
    .from('restaurants')
    .select('id, website_url')
    .eq('id', restaurantId)
    .single();
  if (error) throw error;
  if (!restaurant.website_url) throw new Error(`restaurant ${restaurantId} has no website_url set`);

  await syncRestaurant(supabase, { id: restaurant.id, websiteUrl: restaurant.website_url });
}

/**
 * Nightly entrypoint: sequential, not parallel — one restaurant at a time,
 * skipping sync_enabled = false, per the spec.
 */
export async function runNightlySync(): Promise<void> {
  const supabase = supabaseAdmin();

  const { data: restaurants, error } = await supabase
    .from('restaurants')
    .select('id, website_url')
    .eq('sync_enabled', true)
    .not('website_url', 'is', null);
  if (error) throw error;

  for (const restaurant of restaurants ?? []) {
    if (!restaurant.website_url) continue;
    await syncRestaurant(supabase, { id: restaurant.id, websiteUrl: restaurant.website_url });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const restaurantId = process.argv[2];
  const task = restaurantId ? syncOneRestaurant(restaurantId) : runNightlySync();
  task
    .then(() => console.log('menu sync complete'))
    .catch((err) => {
      console.error('menu sync failed', err);
      process.exit(1);
    });
}
