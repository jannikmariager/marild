import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

// Major market indices symbols
const DEFAULT_SYMBOLS = ['^GSPC', '^IXIC', '^DJI', '^RUT'];

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get symbols from query params or use defaults
    const { searchParams } = new URL(request.url);
    const symbolsParam = searchParams.get('symbols');
    const symbols = symbolsParam ? symbolsParam.split(',') : DEFAULT_SYMBOLS;

    // Call Supabase Edge Function: get_quote_bulk
    const { data, error } = await supabase.functions.invoke('get_quote_bulk', {
      body: { symbols },
    });

    if (error) {
      console.error('Edge Function error:', error);
      return NextResponse.json(
        { message: 'Failed to fetch quotes', error: error.message },
        { status: 500 }
      );
    }

    // Return quotes array
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=60, stale-while-revalidate=30',
      },
    });
  } catch (error) {
    console.error('Quotes API error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
