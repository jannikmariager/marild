import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ is_logged_in: false, is_pro: false, is_trial: false });
  }

  const { data: subStatus } = await supabase
    .from("subscription_status")
    .select("tier")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: trialStatus } = await supabase
    .from("trial_status")
    .select("active")
    .eq("user_id", user.id)
    .maybeSingle();

  const is_pro = subStatus?.tier === "pro";
  const is_trial = trialStatus?.active === true;

  return NextResponse.json({ is_logged_in: true, is_pro, is_trial });
}