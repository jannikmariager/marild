import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { email?: string; message?: string };
    const email = body?.email?.trim();
    const rawMessage = body?.message?.trim();
    const message = rawMessage && rawMessage.length > 0 ? rawMessage : "No message provided";

    if (!email || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const supabase = createSupabaseAdminClient();
    const { error } = await supabase.from("contact_requests").insert({
      email: email.toLowerCase(),
      message,
      source: "landing",
    });

    if (error) {
      console.error("[api/contact] Supabase insert error", error);
      return NextResponse.json({ error: "Failed to submit message" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/contact] Unexpected error", err);
    return NextResponse.json({ error: "Unexpected error" }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Not implemented" }, { status: 405 });
}
