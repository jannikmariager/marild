import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { email } = (await req.json()) as { email?: string };

    if (!email || typeof email !== "string" || !/.+@.+\..+/.test(email.trim())) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const trimmed = email.trim().toLowerCase();

    const { error } = await supabase
      .from("early_access_signups")
      .insert({ email: trimmed });

    if (error) {
      console.error("[api/early-access] Supabase insert error", error);
      // If duplicate (unique constraint), still treat as success for UX
      const isDuplicate =
        typeof error.message === "string" &&
        error.message.toLowerCase().includes("duplicate");
      if (!isDuplicate) {
        return NextResponse.json({ error: "Failed to save email" }, { status: 500 });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/early-access] Unexpected error", e);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Not implemented" }, { status: 405 });
}
