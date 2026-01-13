import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get symbol from query params
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    if (!symbol) {
      return NextResponse.json(
        { message: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    const normalizedSymbol = symbol.trim().toUpperCase();

    // Call news_sentiment_analyzer Edge Function with symbol
    const { data, error } = await supabase.functions.invoke('news_sentiment_analyzer', {
      body: { 
        symbol: normalizedSymbol,
        limit,
      },
    });

    if (error) {
      console.error(`Failed to fetch news for ${normalizedSymbol}:`, error);
      return NextResponse.json(
        { message: 'Failed to fetch news', error: error.message },
        { status: 500 }
      );
    }

    // Transform to match frontend format
    const articles = (data.articles || []).map((article: any) => ({
      headline: article.headline,
      summary: article.description,
      source: article.source || 'Yahoo Finance',
      publishedAt: article.published_at,
      url: article.url,
      sentiment: article.sentiment_label,
      sentimentScore: article.sentiment_score,
      sentimentReason: article.sentiment_reason,
    }));

    return NextResponse.json({
      symbol: normalizedSymbol,
      articles,
      cached: data.cached || false,
    }, {
      headers: {
        'Cache-Control': 'public, max-age=900, stale-while-revalidate=60', // 15 min cache
        'X-News-Cached': data.cached ? 'true' : 'false',
      },
    });
  } catch (error) {
    console.error('Symbol news API error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
