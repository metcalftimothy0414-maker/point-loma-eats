import Link from 'next/link';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { createRestaurant } from '../../lib/restaurants-actions';

export const dynamic = 'force-dynamic';

export default async function RestaurantsPage() {
  const supabase = supabaseAdmin();
  const { data: restaurants } = await supabase.from('restaurants').select('id, name, address, is_active').order('name');

  return (
    <main className="admin-main">
      <h1>Restaurants</h1>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Address</th>
            <th>Active</th>
          </tr>
        </thead>
        <tbody>
          {(restaurants ?? []).map((r) => (
            <tr key={r.id}>
              <td>
                <Link href={`/restaurants/${r.id}`}>{r.name}</Link>
              </td>
              <td>{r.address}</td>
              <td>{r.is_active ? 'yes' : 'no'}</td>
            </tr>
          ))}
          {(restaurants ?? []).length === 0 && (
            <tr>
              <td colSpan={3}>No restaurants yet.</td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="admin-section">
        <h2>Add a restaurant</h2>
        <form action={createRestaurant}>
          <div className="admin-form-row">
            <input className="admin-input" name="name" placeholder="Name" required />
            <input className="admin-input" name="address" placeholder="Address" required />
            <input className="admin-input" name="phone" placeholder="Phone (optional)" />
          </div>
          <div className="admin-form-row">
            <input className="admin-input" name="pickup_instructions" placeholder="Pickup instructions (optional)" />
            <input
              className="admin-input"
              name="estimated_prep_minutes"
              type="number"
              placeholder="Est. prep (min)"
              min={0}
            />
          </div>
          <button className="admin-btn" type="submit">
            Add restaurant
          </button>
        </form>
      </section>
    </main>
  );
}
