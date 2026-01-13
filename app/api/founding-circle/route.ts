import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { email, answers } = (await req.json()) as {
      email?: string;
      answers?: unknown;
    };

    if (!email || typeof email !== "string" || !/.+@.+\..+/.test(email.trim())) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const trimmedEmail = email.trim().toLowerCase();

    // Block repeat submissions from same email
    const { data: existing, error: selectError } = await supabase
      .from("founding_circle_applications")
      .select("id, created_at")
      .eq("email", trimmedEmail)
      .limit(1);

    if (selectError) {
      console.error("[api/founding-circle] select error", selectError);
    }

    if (existing && existing.length > 0) {
      // Calm success: already applied, do not create another row
      return NextResponse.json({ ok: true, alreadyApplied: true });
    }

    const { error: insertError } = await supabase
      .from("founding_circle_applications")
      .insert({
        email: trimmedEmail,
        answers,
      });

    if (insertError) {
      console.error("[api/founding-circle] insert error", insertError);
      return NextResponse.json({ error: "Failed to submit application" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/founding-circle] Unexpected error", e);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Not implemented" }, { status: 405 });
}
