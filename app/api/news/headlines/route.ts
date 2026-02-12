import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooArticles, scoreSentiment, timeAgo } from '@/lib/news/yahoo';

const CATEGORY_QUERIES = {
  all: 'market',
  macro: 'fed OR rates OR inflation OR CPI OR jobs',
  equities: 'stocks OR S&P OR earnings OR Nasdaq',
  crypto: 'bitcoin OR crypto OR ethereum',
  commodities: 'oil OR gold OR OPEC OR copper',
} as const;

type Category = keyof typeof CATEGORY_QUERIES;

const DEFAULT_LIMIT = 12;

function parseCategory(value: string | null): Category {
  if (!value) return 'all';
  const normalized = value.toLowerCase() as Category;
  return normalized in CATEGORY_QUERIES ? normalized : 'all';
}

function clampLimit(limit: number): number {
  if (Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(30, Math.max(5, limit));
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = parseCategory(searchParams.get('category'));
  const limit = clampLimit(parseInt(searchParams.get('limit') ?? `${DEFAULT_LIMIT}`, 10));

  try {
    const articles = await fetchYahooArticles(CATEGORY_QUERIES[category], limit);

    const normalized = articles.map(article => ({
      id: article.id,
      title: article.title,
      source: article.source,
      summary: article.summary,
      published_at: article.publishedAt,
      time_ago: timeAgo(article.publishedAt),
      category,
      sentiment: scoreSentiment(article.title),
      url: article.url,
    }));

    return NextResponse.json({
      category,
      total: normalized.length,
      articles: normalized,
    });
  } catch (error) {
    console.error('[news/headlines] Yahoo fetch failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch news headlines',
        category,
        total: 0,
        articles: [],
      },
      { status: 502 },
    );
  }
}
