import { createClient } from "@supabase/supabase-js";

const urlEnv = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKeyEnv = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!urlEnv || !serviceKeyEnv) {
  console.warn(
    "Supabase admin env vars missing; using placeholder values for build-time."
  );
}

const url = urlEnv ?? "https://placeholder.supabase.co";
const serviceKey = serviceKeyEnv ?? "service-role-placeholder";

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});
