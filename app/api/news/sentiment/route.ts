import { NextRequest, NextResponse } from 'next/server';
import { fetchYahooArticles, scoreSentiment, SentimentLabel } from '@/lib/news/yahoo';

const CATEGORY_QUERIES = {
  all: 'market',
  macro: 'fed OR rates OR inflation OR CPI OR jobs',
  equities: 'stocks OR S&P OR earnings OR Nasdaq',
  crypto: 'bitcoin OR crypto OR ethereum',
  commodities: 'oil OR gold OR OPEC OR copper',
} as const;

type Category = keyof typeof CATEGORY_QUERIES;

const DEFAULT_LIMIT = 25;

function parseCategory(value: string | null): Category {
  if (!value) return 'all';
  const normalized = value.toLowerCase() as Category;
  return normalized in CATEGORY_QUERIES ? normalized : 'all';
}

function clampLimit(limit: number): number {
  if (Number.isNaN(limit)) return DEFAULT_LIMIT;
  return Math.min(50, Math.max(10, limit));
}

const SENTIMENTS: SentimentLabel[] = ['bullish', 'bearish', 'neutral'];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = parseCategory(searchParams.get('category'));
  const limit = clampLimit(parseInt(searchParams.get('limit') ?? `${DEFAULT_LIMIT}`, 10));

  try {
    const articles = await fetchYahooArticles(CATEGORY_QUERIES[category], limit);

    const counts = {
      bullish: 0,
      bearish: 0,
      neutral: 0,
    };

    for (const article of articles) {
      const label = scoreSentiment(article.title);
      counts[label] += 1;
    }

    const total = counts.bullish + counts.bearish + counts.neutral;
    const deltaPct = total === 0 ? 0 : Math.round(((counts.bullish - counts.bearish) / total) * 100);

    let overall: SentimentLabel = 'neutral';
    if (total > 0) {
      const maxCount = Math.max(counts.bullish, counts.bearish, counts.neutral);
      const leaders = SENTIMENTS.filter(label => counts[label] === maxCount);
      overall = leaders.length === 1 ? leaders[0] : 'neutral';
    }

    return NextResponse.json({
      category,
      total,
      overall,
      delta_pct: deltaPct,
      counts,
    });
  } catch (error) {
    console.error('[news/sentiment] Yahoo fetch failed:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch news sentiment',
        category,
        total: 0,
        overall: 'neutral',
        delta_pct: 0,
        counts: { bullish: 0, bearish: 0, neutral: 0 },
      },
      { status: 502 },
    );
  }
}
