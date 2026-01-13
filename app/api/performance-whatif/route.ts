import { createClient } from '@/lib/supabaseServer';
import { NextRequest, NextResponse } from 'next/server';

/**
 * What-If Performance API Route
 * 
 * GET /api/performance-whatif?window=10
 * 
 * Proxies to Supabase Edge Function performance_whatif
 * PRO-only feature
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const window = searchParams.get('window') || '10';

    // Validate window
    const windowNum = parseInt(window, 10);
    if (isNaN(windowNum) || windowNum < 1 || windowNum > 100) {
      return NextResponse.json(
        { error: 'Window must be between 1 and 100' },
        { status: 400 }
      );
    }

    // Get authenticated Supabase client
    const supabase = await createClient();

    console.log('[performance-whatif] calling supabase.auth.getUser()');
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      console.warn('[performance-whatif] getUser error or missing user', error);
      return NextResponse.json(
        { locked: true, message: 'Authentication required' },
        { status: 401 }
      );
    }

    // Call Edge Function directly with query parameter
    const edgeFunctionUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/performance_whatif?window=${window}`;
    const response = await fetch(edgeFunctionUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
        'apikey': process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Edge Function error:', response.status, errorText);
      
      if (response.status === 403) {
        return NextResponse.json(
          { locked: true, message: 'PRO subscription required' },
          { status: 403 }
        );
      }
      
      return NextResponse.json(
        { error: 'Failed to fetch performance data', details: errorText },
        { status: 500 }
      );
    }

    const data = await response.json();

    // Check if locked response
    if (data?.locked) {
      return NextResponse.json(data, { status: 403 });
    }

    // Return success with 15-min cache
    return NextResponse.json(data, {
      status: 200,
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
      },
    });
  } catch (error) {
    console.error('What-If Performance API error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: (error as Error).message },
      { status: 500 }
    );
  }
}
