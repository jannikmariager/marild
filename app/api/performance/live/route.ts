import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

/**
 * GET /api/performance/live
 * Lightweight live stats used on the landing page widget.
 * Currently returns open positions count for the SWING model portfolio.
 */
export async function GET() {
  try {
    const supabase = await createClient();

    const { count, error } = await supabase
      .from('live_positions')
      .select('id', { count: 'exact', head: true })
      .eq('strategy', 'SWING');

    if (error) {
      console.error('[performance/live] Error fetching open positions:', error);
      return NextResponse.json(
        { error: 'Failed to load live portfolio data' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      open_positions: count ?? 0,
    });
  } catch (error) {
    console.error('[performance/live] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
