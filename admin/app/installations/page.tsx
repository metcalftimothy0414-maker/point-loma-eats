import { supabaseAdmin } from '../../lib/supabase-admin';
import {
  createInstallation,
  updateInstallation,
  createZone,
  deleteZone,
  createDeliveryPoint,
  updateDeliveryPoint,
  deleteDeliveryPoint,
} from '../../lib/installations-actions';

export const dynamic = 'force-dynamic';

export default async function InstallationsPage() {
  const supabase = supabaseAdmin();

  const [installationsRes, zonesRes, pointsRes] = await Promise.all([
    supabase.from('installations').select('id, name, address, delivery_radius_meters, status').order('name'),
    supabase.from('delivery_zones').select('id, installation_id, name').order('name'),
    supabase.from('delivery_points').select('id, zone_id, name, instructions, is_active').order('name'),
  ]);

  const installations = installationsRes.data ?? [];
  const zones = zonesRes.data ?? [];
  const points = pointsRes.data ?? [];

  return (
    <main className="admin-main">
      <h1>Installations</h1>

      {installations.map((installation) => {
        const installationZones = zones.filter((z) => z.installation_id === installation.id);

        return (
          <section key={installation.id} className="admin-section">
            <h2>{installation.name}</h2>
            <form action={updateInstallation.bind(null, installation.id)} className="admin-form-row">
              <input className="admin-input" name="name" defaultValue={installation.name} required />
              <input className="admin-input" name="address" defaultValue={installation.address} required />
              <input
                className="admin-input"
                name="delivery_radius_meters"
                type="number"
                min={0}
                defaultValue={installation.delivery_radius_meters ?? ''}
                placeholder="Delivery radius (m)"
              />
              <label>
                <input type="checkbox" name="status" defaultChecked={installation.status === 'active'} /> Active
              </label>
              <button className="admin-btn" type="submit">
                Save
              </button>
            </form>

            <h3>Delivery zones</h3>
            {installationZones.map((zone) => {
              const zonePoints = points.filter((p) => p.zone_id === zone.id);
              return (
                <div key={zone.id} style={{ marginBottom: 16, paddingLeft: 12, borderLeft: '2px solid #eee' }}>
                  <div className="admin-form-row">
                    <strong>{zone.name}</strong>
                    <form action={deleteZone.bind(null, zone.id)}>
                      <button className="admin-btn admin-btn-danger" type="submit">
                        Delete zone
                      </button>
                    </form>
                  </div>

                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Point name</th>
                        <th>Instructions</th>
                        <th>Active</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {zonePoints.map((point) => (
                        <tr key={point.id}>
                          <td colSpan={4} style={{ padding: 0 }}>
                            <form action={updateDeliveryPoint.bind(null, point.id)} className="admin-form-row" style={{ margin: '8px 0' }}>
                              <input className="admin-input" name="name" defaultValue={point.name} required />
                              <input
                                className="admin-input"
                                name="instructions"
                                defaultValue={point.instructions ?? ''}
                                placeholder="Instructions"
                                style={{ width: 220 }}
                              />
                              <label>
                                <input type="checkbox" name="is_active" defaultChecked={point.is_active} /> Active
                              </label>
                              <button className="admin-btn" type="submit">
                                Save
                              </button>
                              <button
                                className="admin-btn admin-btn-danger"
                                type="submit"
                                formAction={deleteDeliveryPoint.bind(null, point.id)}
                              >
                                Delete
                              </button>
                            </form>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  <form action={createDeliveryPoint.bind(null, zone.id)} className="admin-form-row">
                    <input className="admin-input" name="name" placeholder="New delivery point name" required />
                    <input className="admin-input" name="instructions" placeholder="Instructions (optional)" />
                    <button className="admin-btn" type="submit">
                      Add delivery point
                    </button>
                  </form>
                </div>
              );
            })}

            <form action={createZone.bind(null, installation.id)} className="admin-form-row">
              <input className="admin-input" name="name" placeholder="New zone name" required />
              <button className="admin-btn" type="submit">
                Add zone
              </button>
            </form>
          </section>
        );
      })}

      {installations.length === 0 && <p className="admin-muted">No installations yet.</p>}

      <section className="admin-section">
        <h2>Add an installation</h2>
        <form action={createInstallation} className="admin-form-row">
          <input className="admin-input" name="name" placeholder="Name" required />
          <input className="admin-input" name="address" placeholder="Address" required />
          <input className="admin-input" name="delivery_radius_meters" type="number" min={0} placeholder="Delivery radius (m)" />
          <button className="admin-btn" type="submit">
            Add installation
          </button>
        </form>
      </section>
    </main>
  );
}
