import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

// Default symbol for global market news (null = global)
const DEFAULT_SYMBOL = null;

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get symbol from query params (optional)
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol') || DEFAULT_SYMBOL;
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    // Call news_sentiment_analyzer Edge Function
    const { data, error } = await supabase.functions.invoke('news_sentiment_analyzer', {
      body: { 
        symbol,
        limit,
      },
    });

    if (error) {
      console.error('Failed to fetch news with sentiment:', error);
      return NextResponse.json(
        { message: 'Failed to fetch news', error: error.message },
        { status: 500 }
      );
    }

    // Transform to match existing frontend format
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

    return NextResponse.json(articles, {
      headers: {
        'Cache-Control': 'public, max-age=900, stale-while-revalidate=60', // 15 min cache
        'X-News-Cached': data.cached ? 'true' : 'false',
      },
    });
  } catch (error) {
    console.error('News API error:', error);
    return NextResponse.json(
      { message: 'Internal server error' },
      { status: 500 }
    );
  }
}
