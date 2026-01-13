import { NextRequest, NextResponse } from 'next/server';

const EDGE_FUNCTION_URL = process.env.SEND_WELCOME_EMAIL_URL; // e.g. https://<project>.functions.supabase.co/send-welcome-email
const EDGE_FUNCTION_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; // used as Bearer token for Supabase Edge

export async function POST(req: NextRequest) {
  if (!EDGE_FUNCTION_URL) {
    return NextResponse.json({ error: 'Email function URL not configured' }, { status: 500 });
  }
  if (!EDGE_FUNCTION_KEY) {
    return NextResponse.json({ error: 'Supabase anon key not configured' }, { status: 500 });
  }

  try {
    const body = (await req.json()) as {
      user_id: string;
      email: string;
      mode?: 'welcome' | 'resend';
    };

    if (!body.user_id || !body.email) {
      return NextResponse.json({ error: 'Missing user_id or email' }, { status: 400 });
    }

    const payload = {
      user_id: body.user_id,
      email: body.email,
      mode: body.mode ?? 'welcome',
    };

    const edgeResp = await fetch(EDGE_FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: EDGE_FUNCTION_KEY,
        Authorization: `Bearer ${EDGE_FUNCTION_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const edgeJson = await edgeResp.json().catch(() => ({}));

    if (!edgeResp.ok) {
      const message = (edgeJson as any)?.error || 'Failed to send verification email';
      return NextResponse.json({ error: message }, { status: edgeResp.status });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('send-welcome-email API error', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
