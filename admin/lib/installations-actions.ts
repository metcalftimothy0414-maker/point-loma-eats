'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from './supabase-admin';

function optionalString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return value && String(value).trim() ? String(value) : null;
}

export async function createInstallation(formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase.from('installations').insert({
    name: String(formData.get('name')),
    address: String(formData.get('address')),
    delivery_radius_meters: formData.get('delivery_radius_meters') ? Number(formData.get('delivery_radius_meters')) : null,
  });
  if (error) throw new Error(error.message);
  revalidatePath('/installations');
}

export async function updateInstallation(id: string, formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from('installations')
    .update({
      name: String(formData.get('name')),
      address: String(formData.get('address')),
      delivery_radius_meters: formData.get('delivery_radius_meters') ? Number(formData.get('delivery_radius_meters')) : null,
      status: formData.get('status') === 'on' ? 'active' : 'inactive',
    })
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/installations');
}

export async function createZone(installationId: string, formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase.from('delivery_zones').insert({
    installation_id: installationId,
    name: String(formData.get('name')),
  });
  if (error) throw new Error(error.message);
  revalidatePath('/installations');
}

export async function deleteZone(zoneId: string): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase.from('delivery_zones').delete().eq('id', zoneId);
  if (error) throw new Error(error.message);
  revalidatePath('/installations');
}

export async function createDeliveryPoint(zoneId: string, formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase.from('delivery_points').insert({
    zone_id: zoneId,
    name: String(formData.get('name')),
    instructions: optionalString(formData, 'instructions'),
  });
  if (error) throw new Error(error.message);
  revalidatePath('/installations');
}

export async function updateDeliveryPoint(pointId: string, formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from('delivery_points')
    .update({
      name: String(formData.get('name')),
      instructions: optionalString(formData, 'instructions'),
      is_active: formData.get('is_active') === 'on',
    })
    .eq('id', pointId);
  if (error) throw new Error(error.message);
  revalidatePath('/installations');
}

export async function deleteDeliveryPoint(pointId: string): Promise<void> {
  const supabase = supabaseAdmin();
  const { error } = await supabase.from('delivery_points').delete().eq('id', pointId);
  if (error) throw new Error(error.message);
  revalidatePath('/installations');
}
