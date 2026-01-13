import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get region from query params (default US)
    const { searchParams } = new URL(request.url);
    const region = searchParams.get('region') || 'US';

    // Call Supabase Edge Function: get_trending
    const { data: trendingData, error: trendingError } = await supabase.functions.invoke(
      'get_trending',
      { body: { region } }
    );

    if (trendingError) {
      console.error('Trending Edge Function error:', trendingError);
      return NextResponse.json(
        { message: 'Failed to fetch trending data', error: trendingError.message },
        { status: 500 }
      );
    }

    // Get quotes for trending tickers to calculate gainers/losers
    const tickers = trendingData.tickers || [];
    
    if (tickers.length === 0) {
      return NextResponse.json({ gainers: [], losers: [] });
    }

    const { data: quotesData, error: quotesError } = await supabase.functions.invoke(
      'get_quote_bulk',
      { body: { symbols: tickers } }
    );

    if (quotesError) {
      console.error('Quotes Edge Function error:', quotesError);
      return NextResponse.json(
        { message: 'Failed to fetch quote data', error: quotesError.message },
        { status: 500 }
      );
    }

    // Filter and sort quotes
    const quotes = quotesData.quotes || [];
    const validQuotes = quotes.filter((q: any) => q.changePercent !== null);
    
    // Sort by changePercent
    const sorted = validQuotes.sort((a: any, b: any) => b.changePercent - a.changePercent);
    
    // Split into gainers (top 10) and losers (bottom 10)
    const gainers = sorted.filter((q: any) => q.changePercent > 0).slice(0, 10);
    const losers = sorted.filter((q: any) => q.changePercent < 0).slice(-10).reverse();

    return NextResponse.json(
      { gainers, losers },
      {
        headers: {
          'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        },
      }
    );
  } catch (error) {
    console.error('Movers API error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
