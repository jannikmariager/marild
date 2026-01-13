import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !serviceKey) {
  // In admin environment we want this to fail loudly during setup
  throw new Error("Supabase admin env vars are not configured");
}

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
