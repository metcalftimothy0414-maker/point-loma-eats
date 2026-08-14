'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from './supabase-admin';

function optionalString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return value && String(value).trim() ? String(value) : null;
}

export async function createRestaurant(formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase.from('restaurants').insert({
    name: String(formData.get('name')),
    address: String(formData.get('address')),
    phone: optionalString(formData, 'phone'),
    pickup_instructions: optionalString(formData, 'pickup_instructions'),
    estimated_prep_minutes: formData.get('estimated_prep_minutes') ? Number(formData.get('estimated_prep_minutes')) : null,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/restaurants');
}

export async function updateRestaurant(id: string, formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from('restaurants')
    .update({
      name: String(formData.get('name')),
      address: String(formData.get('address')),
      phone: optionalString(formData, 'phone'),
      pickup_instructions: optionalString(formData, 'pickup_instructions'),
      estimated_prep_minutes: formData.get('estimated_prep_minutes') ? Number(formData.get('estimated_prep_minutes')) : null,
      is_active: formData.get('is_active') === 'on',
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath(`/restaurants/${id}`);
  revalidatePath('/restaurants');
}

export async function createMenuCategory(restaurantId: string, formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase.from('menu_categories').insert({
    restaurant_id: restaurantId,
    name: String(formData.get('name')),
    sort_order: formData.get('sort_order') ? Number(formData.get('sort_order')) : 0,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/restaurants/${restaurantId}`);
}

export async function deleteMenuCategory(restaurantId: string, categoryId: string): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase.from('menu_categories').delete().eq('id', categoryId);
  if (error) throw new Error(error.message);
  revalidatePath(`/restaurants/${restaurantId}`);
}

/** base_price only — display_price is trigger-derived (0003_pricing_catalog_orders.sql),
 * never written directly, here or anywhere else. */
export async function createMenuItem(restaurantId: string, formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const categoryId = optionalString(formData, 'category_id');
  const { error } = await supabase.from('menu_items').insert({
    restaurant_id: restaurantId,
    category_id: categoryId,
    name: String(formData.get('name')),
    description: optionalString(formData, 'description'),
    base_price: Number(formData.get('base_price')),
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/restaurants/${restaurantId}`);
}

export async function updateMenuItem(restaurantId: string, itemId: string, formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const categoryId = optionalString(formData, 'category_id');
  const { error } = await supabase
    .from('menu_items')
    .update({
      category_id: categoryId,
      name: String(formData.get('name')),
      description: optionalString(formData, 'description'),
      base_price: Number(formData.get('base_price')),
      is_available: formData.get('is_available') === 'on',
      manual_override: formData.get('manual_override') === 'on',
    })
    .eq('id', itemId);
  if (error) throw new Error(error.message);
  revalidatePath(`/restaurants/${restaurantId}`);
}

export async function deleteMenuItem(restaurantId: string, itemId: string): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase.from('menu_items').delete().eq('id', itemId);
  if (error) throw new Error(error.message);
  revalidatePath(`/restaurants/${restaurantId}`);
}
