'use server';

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from './supabase-admin';

export async function createPricingSettings(formData: FormData): Promise<void> {
  const supabase = supabaseAdmin();
  const effectiveFrom = formData.get('effective_from');

  const { error } = await supabase.from('pricing_settings').insert({
    markup_pct: Number(formData.get('markup_pct')),
    minimum_subtotal: Number(formData.get('minimum_subtotal')),
    on_demand_markup_pct: Number(formData.get('on_demand_markup_pct')),
    // Omit entirely rather than pass an empty string — the column has its
    // own default (now()) that a blank value would incorrectly override.
    ...(effectiveFrom ? { effective_from: new Date(String(effectiveFrom)).toISOString() } : {}),
  });
  if (error) throw new Error(error.message);

  revalidatePath('/pricing');
}
