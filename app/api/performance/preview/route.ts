import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

export async function GET() {
  try {
    const supabase = await createClient();

    // Call Supabase Edge Function for real performance data
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const { data: session } = await supabase.auth.getSession();
    const accessToken = session?.session?.access_token || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
    
    try {
      const response = await fetch(`${supabaseUrl}/functions/v1/performance_whatif?window=20`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[Performance Preview] Edge Function error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText,
        });
        return NextResponse.json(
          { error: 'EDGE_FUNCTION_ERROR', message: `Failed to fetch performance data: ${response.status}` },
          { status: 502 },
        );
      }

      const whatIfData = await response.json();

      const previewData = {
        return_pct: whatIfData.total_return_pct / 100, // percentage → decimal
        win_rate: whatIfData.win_rate / 100,
        best_trade: whatIfData.best_return / 100,
        worst_trade: whatIfData.worst_return / 100,
        sparkline: (whatIfData.equity_curve || []).map((point: any) => point.equity),
        spy_return: whatIfData.spy_return ? whatIfData.spy_return / 100 : undefined,
        qqq_return: whatIfData.qqq_return ? whatIfData.qqq_return / 100 : undefined,
        is_live: true,
        access: { is_locked: false },
      };

      return NextResponse.json(previewData);
    } catch (error) {
      console.error('[Performance Preview] Error calling performance_whatif:', error);
      return NextResponse.json(
        { error: 'SERVER_ERROR', message: 'Performance data temporarily unavailable' },
        { status: 500 },
      );
    }
  } catch (error) {
    console.error('Error fetching performance preview:', error);
    return NextResponse.json(
      { error: 'SERVER_ERROR', message: 'Performance data temporarily unavailable' },
      { status: 500 }
    );
  }
}
