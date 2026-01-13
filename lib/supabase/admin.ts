import { createClient } from '@supabase/supabase-js'

export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !serviceKey) throw new Error('Supabase admin env vars not set')
  // Note: If falling back to ANON, reads must be allowed by RLS. This path is for local/dev only.
  return createClient(url, serviceKey, { auth: { persistSession: false } })
}
