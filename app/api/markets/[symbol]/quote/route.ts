import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

export async function GET(request: NextRequest, context: { params: Promise<{ symbol: string }> }) {
  try {
    const supabase = await createClient();
    const params = await context.params;

    // Derive symbol from either params or URL path as fallback
    const url = new URL(request.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const marketsIndex = segments.indexOf('markets');
    const fromPath = marketsIndex >= 0 && segments.length > marketsIndex + 1
      ? segments[marketsIndex + 1]
      : '';

    const rawSymbol = params?.symbol ?? fromPath ?? '';
    const symbol = rawSymbol.toUpperCase();
    if (!symbol) {
      return NextResponse.json({ error: 'MISSING_SYMBOL' }, { status: 400 });
    }

    // Quote is FREE: require session but no PRO gate
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session) {
      return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const token = session.access_token || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const resp = await fetch(`${supabaseUrl}/functions/v1/get_quote`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ ticker: symbol }),
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      console.error('[quote] edge error', errorData);
      return NextResponse.json({ error: 'QUOTE_ERROR' }, { status: 502 });
    }

    const data = await resp.json();

    return NextResponse.json(
      {
        symbol,
        name: symbol,
        price: data.price ?? null,
        change: data.change ?? null,
        changePct: data.changePercent ?? null,
        currency: data.currency ?? 'USD',
        updatedAt: new Date().toISOString(),
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=60, stale-while-revalidate=60',
        },
      }
    );
  } catch (error: any) {
    console.error('[markets quote] error', error);
    return NextResponse.json(
      { error: 'SYSTEM_ERROR', message: error.message || 'Failed to fetch quote' },
      { status: 500 }
    );
  }
}
