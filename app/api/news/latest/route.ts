import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';

const DEV_FORCE_PRO = process.env.NEXT_PUBLIC_DEV_FORCE_PRO === 'true';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '5', 10);

    // Get user session (optional for news - can be public)
    const {
      data: { session },
    } = await supabase.auth.getSession();

    // Only treat items from the last 48 hours as "latest"; older cached
    // entries are ignored so the UI doesn't show stale stories as fresh.
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: news, error: newsError } = await supabase
      .from('news_cache')
      .select('*')
      .gte('published_at', cutoff)
      .order('published_at', { ascending: false })
      .limit(limit);

    if (newsError) {
      console.error('[Latest News API] Error fetching news:', newsError);
      return NextResponse.json(
        { error: 'Failed to fetch news', news: [] },
        { status: 500 }
      );
    }

    if (!news || news.length === 0) {
      return NextResponse.json([]);
    }

    // Transform to expected format
    const transformedNews = news.map((item) => ({
      title: item.title || item.headline,
      source: item.source || 'Market News',
      published_at: item.published_at,
      sentiment: item.sentiment || 'neutral',
      sentiment_score: item.sentiment_score || 50,
      summary: item.summary || item.title?.substring(0, 120) + '...' || '',
      url: item.url || item.link || '#',
    }));

    return NextResponse.json(transformedNews);
  } catch (error: any) {
    console.error('[Latest News API] Error:', error);
    return NextResponse.json(
      { error: error.message, news: [] },
      { status: 500 }
    );
  }
}
