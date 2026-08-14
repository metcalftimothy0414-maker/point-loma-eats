import { supabaseAdmin } from '../../lib/supabase-admin';
import { approveChange, rejectChange, bulkApprove, triggerSync } from '../../lib/actions';

export const dynamic = 'force-dynamic';

interface RestaurantRow {
  id: string;
  name: string;
  sync_enabled: boolean;
  sync_status: string | null;
  last_sync_at: string | null;
}

interface RunRow {
  id: string;
  restaurant_id: string;
  source_platform: string;
  source_url: string | null;
  status: string;
  items_found: number;
  items_changed: number;
  error: string | null;
  started_at: string;
  completed_at: string | null;
}

interface PendingChangeRow {
  id: string;
  menu_item_id: string | null;
  change_type: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  confidence: number;
  sync_run_id: string;
  created_at: string;
}

function formatDollars(value: unknown): string {
  return typeof value === 'number' ? `$${value.toFixed(2)}` : String(value ?? '—');
}

function describeChange(change: PendingChangeRow): string {
  switch (change.change_type) {
    case 'price':
      return `${formatDollars(change.old_value?.basePrice)} → ${formatDollars(change.new_value?.basePrice)}`;
    case 'availability':
      return `available: ${change.old_value?.isAvailable} → ${change.new_value?.isAvailable}`;
    case 'new':
      return `new item: ${(change.new_value as { name?: string } | null)?.name ?? '(unnamed)'} at ${formatDollars(
        (change.new_value as { basePrice?: number } | null)?.basePrice
      )}`;
    case 'delete':
      return `remove: ${(change.old_value as { name?: string } | null)?.name ?? change.menu_item_id}`;
    default:
      return change.change_type;
  }
}

export default async function MenuSyncPage() {
  const supabase = supabaseAdmin();

  const [restaurantsRes, pendingRes, runsRes] = await Promise.all([
    supabase
      .from('restaurants')
      .select('id, name, sync_enabled, sync_status, last_sync_at')
      .order('name'),
    supabase
      .from('menu_item_changes')
      .select('id, menu_item_id, change_type, old_value, new_value, confidence, sync_run_id, created_at')
      .eq('status', 'pending_review')
      .order('created_at', { ascending: false }),
    supabase
      .from('menu_sync_runs')
      .select('id, restaurant_id, source_platform, source_url, status, items_found, items_changed, error, started_at, completed_at')
      .order('started_at', { ascending: false })
      .limit(30),
  ]);

  const restaurants = (restaurantsRes.data ?? []) as RestaurantRow[];
  const pendingChanges = (pendingRes.data ?? []) as PendingChangeRow[];
  const runs = (runsRes.data ?? []) as RunRow[];

  const restaurantNameById = new Map(restaurants.map((r) => [r.id, r.name]));
  const runById = new Map(runs.map((r) => [r.id, r]));

  // Pending changes reference a sync_run_id but not every referenced run is
  // necessarily in the last 30 fetched above — fetch any missing ones so
  // "which restaurant is this change for" never silently falls back to "—".
  const missingRunIds = [...new Set(pendingChanges.map((c) => c.sync_run_id))].filter((id) => !runById.has(id));
  if (missingRunIds.length > 0) {
    const { data: extraRuns } = await supabase
      .from('menu_sync_runs')
      .select('id, restaurant_id')
      .in('id', missingRunIds);
    for (const run of extraRuns ?? []) runById.set(run.id, run as RunRow);
  }

  return (
    <main className="admin-main">
      <h1>Menu Sync</h1>

      <section className="admin-section">
        <h2>Restaurants</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Sync</th>
              <th>Status</th>
              <th>Last sync</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {restaurants.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.sync_enabled ? 'enabled' : 'disabled'}</td>
                <td>{r.sync_status ?? '—'}</td>
                <td>{r.last_sync_at ? new Date(r.last_sync_at).toLocaleString() : 'never'}</td>
                <td>
                  <form action={triggerSync.bind(null, r.id)}>
                    <button className="admin-btn" type="submit">
                      Sync now
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {restaurants.length === 0 && (
              <tr>
                <td colSpan={5}>No restaurants yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="admin-section">
        <h2>Pending review ({pendingChanges.length})</h2>
        {pendingChanges.length > 0 && (
          <form action={bulkApprove}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th />
                  <th>Restaurant</th>
                  <th>Type</th>
                  <th>Change</th>
                  <th>Confidence</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pendingChanges.map((change) => {
                  const run = runById.get(change.sync_run_id);
                  const restaurantName = run ? restaurantNameById.get(run.restaurant_id) : undefined;
                  return (
                    <tr key={change.id}>
                      <td>
                        <input type="checkbox" name="changeId" value={change.id} />
                      </td>
                      <td>{restaurantName ?? '—'}</td>
                      <td>{change.change_type}</td>
                      <td>{describeChange(change)}</td>
                      <td>{change.confidence.toFixed(2)}</td>
                      <td style={{ display: 'flex', gap: 8 }}>
                        <button className="admin-btn" type="submit" formAction={approveChange.bind(null, change.id)}>
                          Approve
                        </button>
                        <button
                          className="admin-btn admin-btn-secondary"
                          type="submit"
                          formAction={rejectChange.bind(null, change.id)}
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button className="admin-btn" type="submit" style={{ marginTop: 12 }}>
              Bulk approve selected
            </button>
          </form>
        )}
        {pendingChanges.length === 0 && <p className="admin-muted">Nothing waiting on review.</p>}
      </section>

      <section className="admin-section">
        <h2>Run history</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Restaurant</th>
              <th>Platform</th>
              <th>Status</th>
              <th>Found</th>
              <th>Changed</th>
              <th>Started</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id}>
                <td>{restaurantNameById.get(run.restaurant_id) ?? '—'}</td>
                <td>{run.source_platform}</td>
                <td>{run.status}</td>
                <td>{run.items_found}</td>
                <td>{run.items_changed}</td>
                <td>{new Date(run.started_at).toLocaleString()}</td>
                <td>{run.error ?? ''}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={7}>No sync runs yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
