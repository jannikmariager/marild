import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

export async function GET() {
  try {
    const supabase = await createClient();

    const sessionResult = await supabase.auth.getSession();
    const userResult = await supabase.auth.getUser();

    return NextResponse.json({
      session: {
        hasSession: Boolean(sessionResult.data.session),
        sessionUserId: sessionResult.data.session?.user?.id ?? null,
        error: sessionResult.error ? sessionResult.error.message : null,
      },
      user: {
        hasUser: Boolean(userResult.data.user),
        userId: userResult.data.user?.id ?? null,
        email: userResult.data.user?.email ?? null,
        error: userResult.error ? userResult.error.message : null,
      },
    });
  } catch (err: unknown) {
    return NextResponse.json(
      {
        error: 'DEBUG_ROUTE_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
