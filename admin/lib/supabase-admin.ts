import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client — bypasses RLS entirely. Server-only
 * ('server-only' import throws if this ever ends up in a client bundle).
 *
 * This is a deliberate shortcut for a single-founder admin tool: rather
 * than building full Supabase Auth (session cookies, login page, RLS
 * checking auth.uid()) for an app with exactly one real user, access
 * control here is the Basic Auth gate in middleware.ts, and every query
 * just uses the service role directly. Revisit if a second admin user is
 * ever a real thing.
 */
export function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
  }
  return createClient(url, serviceRoleKey);
}
