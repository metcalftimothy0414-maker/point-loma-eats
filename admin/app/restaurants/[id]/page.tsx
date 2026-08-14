import { notFound } from 'next/navigation';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import {
  updateRestaurant,
  createMenuCategory,
  deleteMenuCategory,
  createMenuItem,
  updateMenuItem,
  deleteMenuItem,
} from '../../../lib/restaurants-actions';

export const dynamic = 'force-dynamic';

export default async function RestaurantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = supabaseAdmin();

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('id, name, address, phone, pickup_instructions, estimated_prep_minutes, is_active')
    .eq('id', id)
    .single();
  if (!restaurant) notFound();

  const [categoriesRes, itemsRes] = await Promise.all([
    supabase.from('menu_categories').select('id, name, sort_order').eq('restaurant_id', id).order('sort_order'),
    supabase
      .from('menu_items')
      .select('id, category_id, name, description, base_price, display_price, is_available, manual_override, source_platform')
      .eq('restaurant_id', id)
      .order('name'),
  ]);
  const categories = categoriesRes.data ?? [];
  const items = itemsRes.data ?? [];
  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));

  const updateRestaurantWithId = updateRestaurant.bind(null, id);
  const createMenuCategoryHere = createMenuCategory.bind(null, id);
  const createMenuItemHere = createMenuItem.bind(null, id);

  return (
    <main className="admin-main">
      <h1>{restaurant.name}</h1>

      <section className="admin-section">
        <h2>Details</h2>
        <form action={updateRestaurantWithId}>
          <div className="admin-form-row">
            <input className="admin-input" name="name" defaultValue={restaurant.name} required />
            <input className="admin-input" name="address" defaultValue={restaurant.address} required />
            <input className="admin-input" name="phone" defaultValue={restaurant.phone ?? ''} placeholder="Phone" />
          </div>
          <div className="admin-form-row">
            <input
              className="admin-input"
              name="pickup_instructions"
              defaultValue={restaurant.pickup_instructions ?? ''}
              placeholder="Pickup instructions"
            />
            <input
              className="admin-input"
              name="estimated_prep_minutes"
              type="number"
              min={0}
              defaultValue={restaurant.estimated_prep_minutes ?? ''}
              placeholder="Est. prep (min)"
            />
            <label>
              <input type="checkbox" name="is_active" defaultChecked={restaurant.is_active} /> Active
            </label>
          </div>
          <button className="admin-btn" type="submit">
            Save
          </button>
        </form>
      </section>

      <section className="admin-section">
        <h2>Menu categories</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Sort order</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.sort_order}</td>
                <td>
                  <form action={deleteMenuCategory.bind(null, id, c.id)}>
                    <button className="admin-btn admin-btn-danger" type="submit">
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <form action={createMenuCategoryHere} className="admin-form-row">
          <input className="admin-input" name="name" placeholder="Category name" required />
          <input className="admin-input" name="sort_order" type="number" placeholder="Sort order" defaultValue={0} />
          <button className="admin-btn" type="submit">
            Add category
          </button>
        </form>
      </section>

      <section className="admin-section">
        <h2>Menu items</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Category</th>
              <th>Base price</th>
              <th>Display price</th>
              <th>Available</th>
              <th>Manual override</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td colSpan={8} style={{ padding: 0 }}>
                  <form action={updateMenuItem.bind(null, id, item.id)} className="admin-form-row" style={{ margin: '8px 0' }}>
                    <input className="admin-input" name="name" defaultValue={item.name} required style={{ width: 140 }} />
                    <select className="admin-select" name="category_id" defaultValue={item.category_id ?? ''}>
                      <option value="">(none)</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className="admin-input"
                      name="description"
                      defaultValue={item.description ?? ''}
                      placeholder="Description"
                      style={{ width: 160 }}
                    />
                    <input
                      className="admin-input"
                      name="base_price"
                      type="number"
                      step="0.01"
                      min={0}
                      defaultValue={item.base_price}
                      required
                      style={{ width: 80 }}
                    />
                    <span className="admin-muted">display: ${item.display_price.toFixed(2)}</span>
                    <label>
                      <input type="checkbox" name="is_available" defaultChecked={item.is_available} /> Available
                    </label>
                    <label>
                      <input type="checkbox" name="manual_override" defaultChecked={item.manual_override} /> Manual
                      override
                    </label>
                    {item.source_platform && <span className="admin-muted">synced via {item.source_platform}</span>}
                    <button className="admin-btn" type="submit">
                      Save
                    </button>
                    <button
                      className="admin-btn admin-btn-danger"
                      type="submit"
                      formAction={deleteMenuItem.bind(null, id, item.id)}
                    >
                      Delete
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p className="admin-muted">No menu items yet.</p>}

        <h3 className="admin-section">Add menu item</h3>
        <form action={createMenuItemHere} className="admin-form-row">
          <input className="admin-input" name="name" placeholder="Name" required />
          <select className="admin-select" name="category_id" defaultValue="">
            <option value="">(none)</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input className="admin-input" name="description" placeholder="Description (optional)" />
          <input className="admin-input" name="base_price" type="number" step="0.01" min={0} placeholder="Base price" required />
          <button className="admin-btn" type="submit">
            Add item
          </button>
        </form>
        <p className="admin-muted">
          Base price is what the restaurant charges — display price (what the customer pays) is derived
          automatically from the current markup and can't be set directly here.
        </p>
      </section>
    </main>
  );
}
