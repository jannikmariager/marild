/**
 * News Sentiment Aggregator for TradeSignal Engine
 * 
 * Fetches and aggregates news sentiment from news_cache table
 * to provide sentiment context for signal generation.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

export interface NewsSentimentSummary {
  total_articles: number;
  bullish_count: number;
  bearish_count: number;
  neutral_count: number;
  aggregate_score: number; // 0.0-1.0 where 0.5 is neutral, >0.5 is bullish, <0.5 is bearish
  confidence: number; // 0.0-1.0 average of sentiment scores
  most_recent: Array<{
    headline: string;
    sentiment_label: string;
    sentiment_score: number;
    published_at: string;
  }>;
  overall_bias: 'bullish' | 'bearish' | 'neutral';
  time_window_hours: number;
}

/**
 * Fetch and aggregate news sentiment for a symbol
 */
export async function fetchNewsSentiment(
  symbol: string,
  timeWindowHours: number = 24
): Promise<NewsSentimentSummary> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseKey) {
    console.warn('[fetchNewsSentiment] Supabase credentials missing, returning neutral');
    return createNeutralSentiment(timeWindowHours);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Calculate time threshold
    const timeThreshold = new Date(Date.now() - timeWindowHours * 60 * 60 * 1000);

    // Fetch news from news_cache
    const { data: newsArticles, error } = await supabase
      .from('news_cache')
      .select('headline, sentiment_label, sentiment_score, published_at')
      .eq('symbol', symbol.toUpperCase())
      .gte('published_at', timeThreshold.toISOString())
      .order('published_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('[fetchNewsSentiment] Database error:', error);
      return createNeutralSentiment(timeWindowHours);
    }

    if (!newsArticles || newsArticles.length === 0) {
      console.log(`[fetchNewsSentiment] No news found for ${symbol}`);
      return createNeutralSentiment(timeWindowHours);
    }

    // Count sentiments
    let bullishCount = 0;
    let bearishCount = 0;
    let neutralCount = 0;
    let totalScore = 0;
    let totalConfidence = 0;

    newsArticles.forEach((article: any) => {
      const label = (article.sentiment_label || 'neutral').toLowerCase();
      const score = article.sentiment_score || 0.5;

      if (label === 'bullish') bullishCount++;
      else if (label === 'bearish') bearishCount++;
      else neutralCount++;

      // Convert sentiment to 0-1 scale
      // bullish -> higher score, bearish -> lower score
      if (label === 'bullish') {
        totalScore += score;
      } else if (label === 'bearish') {
        totalScore += (1.0 - score);
      } else {
        totalScore += 0.5;
      }

      totalConfidence += score;
    });

    const totalArticles = newsArticles.length;
    const aggregateScore = totalScore / totalArticles;
    const avgConfidence = totalConfidence / totalArticles;

    // Determine overall bias
    let overallBias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (aggregateScore > 0.6) overallBias = 'bullish';
    else if (aggregateScore < 0.4) overallBias = 'bearish';

    // Get most recent articles
    const mostRecent = newsArticles.slice(0, 5).map((article: any) => ({
      headline: article.headline,
      sentiment_label: article.sentiment_label || 'neutral',
      sentiment_score: article.sentiment_score || 0.5,
      published_at: article.published_at,
    }));

    console.log(
      `[fetchNewsSentiment] ${symbol}: ${totalArticles} articles, ` +
      `${bullishCount}B/${bearishCount}B/${neutralCount}N, ` +
      `aggregate: ${(aggregateScore * 100).toFixed(0)}%, bias: ${overallBias}`
    );

    return {
      total_articles: totalArticles,
      bullish_count: bullishCount,
      bearish_count: bearishCount,
      neutral_count: neutralCount,
      aggregate_score: aggregateScore,
      confidence: avgConfidence,
      most_recent: mostRecent,
      overall_bias: overallBias,
      time_window_hours: timeWindowHours,
    };
  } catch (error) {
    console.error('[fetchNewsSentiment] Unexpected error:', error);
    return createNeutralSentiment(timeWindowHours);
  }
}

/**
 * Create neutral sentiment fallback
 */
function createNeutralSentiment(timeWindowHours: number): NewsSentimentSummary {
  return {
    total_articles: 0,
    bullish_count: 0,
    bearish_count: 0,
    neutral_count: 0,
    aggregate_score: 0.5,
    confidence: 0.0,
    most_recent: [],
    overall_bias: 'neutral',
    time_window_hours: timeWindowHours,
  };
}

/**
 * Format sentiment summary for AI prompt
 */
export function formatSentimentForPrompt(sentiment: NewsSentimentSummary): string {
  if (sentiment.total_articles === 0) {
    return `NEWS SENTIMENT DATA:
- No recent news articles found for analysis
- Sentiment: Neutral (no data)
- Impact: Consider technical and fundamental factors only`;
  }

  const percentBullish = ((sentiment.bullish_count / sentiment.total_articles) * 100).toFixed(0);
  const percentBearish = ((sentiment.bearish_count / sentiment.total_articles) * 100).toFixed(0);
  const percentNeutral = ((sentiment.neutral_count / sentiment.total_articles) * 100).toFixed(0);

  const sentimentStrength = 
    sentiment.aggregate_score > 0.7 ? 'Very Bullish' :
    sentiment.aggregate_score > 0.6 ? 'Moderately Bullish' :
    sentiment.aggregate_score > 0.4 ? 'Neutral' :
    sentiment.aggregate_score > 0.3 ? 'Moderately Bearish' :
    'Very Bearish';

  let prompt = `NEWS SENTIMENT DATA:
- Total articles analyzed (last ${sentiment.time_window_hours}h): ${sentiment.total_articles}
- Bullish articles: ${sentiment.bullish_count} (${percentBullish}%)
- Bearish articles: ${sentiment.bearish_count} (${percentBearish}%)
- Neutral articles: ${sentiment.neutral_count} (${percentNeutral}%)
- Aggregate sentiment: ${sentimentStrength} (score: ${(sentiment.aggregate_score * 100).toFixed(0)}/100)
- Average confidence: ${(sentiment.confidence * 100).toFixed(0)}%`;

  if (sentiment.most_recent.length > 0) {
    prompt += `\n- Most recent articles:`;
    sentiment.most_recent.slice(0, 3).forEach((article, index) => {
      const conf = (article.sentiment_score * 100).toFixed(0);
      prompt += `\n  ${index + 1}) "${article.headline}" → ${article.sentiment_label.toUpperCase()} (${conf}% confidence)`;
    });
  }

  return prompt;
}
