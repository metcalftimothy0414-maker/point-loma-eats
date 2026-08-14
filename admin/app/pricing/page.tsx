import { supabaseAdmin } from '../../lib/supabase-admin';
import { createPricingSettings } from '../../lib/pricing-actions';

export const dynamic = 'force-dynamic';

export default async function PricingPage() {
  const supabase = supabaseAdmin();

  // Direct table query, not the current_pricing_settings() RPC — that
  // function had EXECUTE revoked from PUBLIC (0003_pricing_catalog_orders.sql,
  // to stop anon/authenticated reading markup off it), and it's owned by
  // whoever ran the migration, not service_role, so whether service_role
  // still has EXECUTE on it isn't something to assume. The table itself
  // has no RLS policies at all (deny-by-default), but service_role's
  // BYPASSRLS attribute skips RLS checks entirely, and it has the same
  // table-level grants as anon/authenticated — so a direct query here is
  // both simpler and avoids that open question altogether.
  const { data: history } = await supabase
    .from('pricing_settings')
    .select('id, markup_pct, minimum_subtotal, on_demand_markup_pct, effective_from, created_at')
    .order('effective_from', { ascending: false });

  const rows = history ?? [];
  const now = new Date();
  const current = rows.find((r) => new Date(r.effective_from) <= now);

  return (
    <main className="admin-main">
      <h1>Pricing</h1>

      <section className="admin-section">
        <h2>Current</h2>
        {current ? (
          <div className="admin-stats-row">
            <div className="admin-stat-box">
              <div className="admin-stat-value">{(current.markup_pct * 100).toFixed(0)}%</div>
              <div className="admin-stat-label">Markup</div>
            </div>
            <div className="admin-stat-box">
              <div className="admin-stat-value">${current.minimum_subtotal.toFixed(2)}</div>
              <div className="admin-stat-label">Minimum subtotal</div>
            </div>
            <div className="admin-stat-box">
              <div className="admin-stat-value">{(current.on_demand_markup_pct * 100).toFixed(0)}%</div>
              <div className="admin-stat-label">On-demand markup</div>
            </div>
          </div>
        ) : (
          <p className="admin-error">
            No effective pricing_settings row — every menu item is silently pricing at 0% markup until one exists.
          </p>
        )}
      </section>

      <section className="admin-section">
        <h2>Set new pricing</h2>
        <p className="admin-muted">
          Inserts a new row rather than editing the current one — pricing is versioned by effective_from so past
          orders keep the rate that was actually in effect when they were placed. A past/present effective date
          applies immediately and reprices every menu item's display_price (0003's trigger); a future date is
          stored but won't take effect until then automatically (there's no scheduler — see ARCHITECTURE.md).
        </p>
        <form action={createPricingSettings}>
          <div className="admin-form-row">
            <label>
              Markup %{' '}
              <input
                className="admin-input"
                name="markup_pct"
                type="number"
                step="0.01"
                min={0}
                defaultValue={current?.markup_pct ?? 0.45}
                required
              />
            </label>
            <label>
              Minimum subtotal ($){' '}
              <input
                className="admin-input"
                name="minimum_subtotal"
                type="number"
                step="0.01"
                min={0}
                defaultValue={current?.minimum_subtotal ?? 15.0}
                required
              />
            </label>
            <label>
              On-demand markup %{' '}
              <input
                className="admin-input"
                name="on_demand_markup_pct"
                type="number"
                step="0.01"
                min={0}
                defaultValue={current?.on_demand_markup_pct ?? 0.55}
                required
              />
            </label>
          </div>
          <div className="admin-form-row">
            <label>
              Effective from (optional, defaults to now){' '}
              <input className="admin-input" name="effective_from" type="datetime-local" />
            </label>
          </div>
          <button className="admin-btn" type="submit">
            Save new pricing
          </button>
        </form>
      </section>

      <section className="admin-section">
        <h2>History</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Markup</th>
              <th>Minimum subtotal</th>
              <th>On-demand markup</th>
              <th>Effective from</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{(r.markup_pct * 100).toFixed(0)}%</td>
                <td>${r.minimum_subtotal.toFixed(2)}</td>
                <td>{(r.on_demand_markup_pct * 100).toFixed(0)}%</td>
                <td>{new Date(r.effective_from).toLocaleString()}</td>
                <td>{new Date(r.created_at).toLocaleString()}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5}>No pricing history yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}
