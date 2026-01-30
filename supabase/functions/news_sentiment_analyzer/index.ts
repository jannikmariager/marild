/**
 * News Sentiment Analyzer Edge Function
 * 
 * Fetches news for a symbol (or global market news), analyzes sentiment with AI,
 * caches results in news_cache table, and returns structured data.
 * 
 * Input:
 *  - symbol: optional stock ticker (e.g. "NVDA"), if missing → global news
 *  - limit: optional max articles (default 20)
 * 
 * Output:
 *  - symbol: the input symbol or null
 *  - articles: array of news with sentiment analysis
 *  - cached: boolean indicating if results came from cache
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import OpenAI from 'https://esm.sh/openai@4.20.1';
import { corsHeaders } from '../_shared/cors.ts';
import { logOpenAiUsage } from '../_shared/ai_usage_logger.ts';
import { logDataCost } from '../_shared/data_cost_logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Cache TTL: 15 minutes for news
const CACHE_TTL_MINUTES = 15;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

interface NewsArticle {
  headline: string;
  description: string | null;
  source: string | null;
  url: string;
  published_at: string;
  sentiment_label: string;
  sentiment_score: number;
  sentiment_reason: string;
}

interface SentimentAnalysis {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reason: string;
}

interface SentimentOverview {
  overall_sentiment: 'bullish' | 'bearish' | 'neutral';
  sentiment_score: number; // -1 to 1
  bullish_count: number;
  bearish_count: number;
  neutral_count: number;
  key_topics: string[];
  market_impact: 'positive' | 'negative' | 'neutral';
}

interface NewsSentimentResponse {
  symbol: string | null;
  articles: NewsArticle[];
  overview?: SentimentOverview; // PRO only
  cached: boolean;
  access: {
    is_locked: boolean;
    total_articles: number;
    unlocked_articles: number;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Initialize clients
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const openaiKey = Deno.env.get('OPENAI_API_KEY');

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase credentials');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const openai = openaiKey ? new OpenAI({ apiKey: openaiKey }) : null;

    // Parse request
    const { symbol, limit = DEFAULT_LIMIT } = await req.json().catch(() => ({}));
    const normalizedSymbol = symbol ? symbol.trim().toUpperCase() : null;
    const maxArticles = Math.min(limit, MAX_LIMIT);

    console.log(`[news_sentiment_analyzer] Fetching news for ${normalizedSymbol || 'global market'}, limit: ${maxArticles}`);

    // Get user and subscription status
    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    let hasPro = false;
    
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      
      if (!userError && user) {
        userId = user.id;
        const subscriptionStatus = await getUserSubscriptionStatus(userId, supabaseUrl, supabaseKey);
        hasPro = hasProAccess(subscriptionStatus);
      }
    }

    // ============================================================
    // 1. CHECK CACHE
    // ============================================================
    const cacheThreshold = new Date(Date.now() - CACHE_TTL_MINUTES * 60 * 1000);
    
    const { data: cachedNews, error: cacheError } = await supabase
      .from('news_cache')
      .select('*')
      .eq('symbol', normalizedSymbol)
      .gte('published_at', cacheThreshold.toISOString())
      .order('published_at', { ascending: false })
      .limit(maxArticles);

    if (!cacheError && cachedNews && cachedNews.length >= Math.min(5, maxArticles)) {
      console.log(`[news_sentiment_analyzer] Cache hit: ${cachedNews.length} articles`);
      
      const articles = cachedNews.map((item: any) => ({
        headline: item.headline,
        description: item.description,
        source: item.source,
        url: item.url,
        published_at: item.published_at,
        sentiment_label: item.sentiment_label,
        sentiment_score: item.sentiment_score,
        sentiment_reason: item.sentiment_reason,
      }));

      // Apply PRO gating
      const gatedArticles = hasPro ? articles : articles.slice(0, 3); // Free: only 3 articles
      const overview = hasPro ? generateSentimentOverview(articles) : undefined;

      return new Response(
        JSON.stringify({
          symbol: normalizedSymbol,
          articles: gatedArticles,
          overview,
          cached: true,
          access: {
            is_locked: !hasPro,
            total_articles: articles.length,
            unlocked_articles: gatedArticles.length,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // ============================================================
    // 2. FETCH FRESH NEWS FROM YAHOO FINANCE
    // ============================================================
    console.log(`[news_sentiment_analyzer] Cache miss, fetching fresh news`);

    // Use symbol or default to market indices for global news
    const searchSymbol = normalizedSymbol || 'SPY';
    
    const newsUrl = `https://query1.finance.yahoo.com/v1/finance/search?q=${searchSymbol}&newsCount=${maxArticles}&quotesCount=0`;
    
    const newsResponse = await fetch(newsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
    });

    if (!newsResponse.ok) {
      throw new Error(`Yahoo Finance API error: ${newsResponse.status}`);
    }

    const newsData = await newsResponse.json();
    const rawNews = newsData.news || [];
    
    // Log Yahoo Finance API usage (free but track it)
    await logDataCost({ provider: 'yahoo_finance' });

    if (rawNews.length === 0) {
      console.log(`[news_sentiment_analyzer] No news found for ${searchSymbol}`);
      return new Response(
        JSON.stringify({
          symbol: normalizedSymbol,
          articles: [],
          cached: false,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`[news_sentiment_analyzer] Fetched ${rawNews.length} raw articles`);

    // ============================================================
    // 3. ANALYZE SENTIMENT WITH AI
    // ============================================================
    const analyzedArticles: NewsArticle[] = [];
    let aiCallCount = 0;
    let totalCost = 0;

    for (const item of rawNews) {
      const headline = item.title || '';
      const description = item.summary || null;
      const source = item.publisher || 'Yahoo Finance';
      const url = item.link || '';
      const published_at = item.providerPublishTime
        ? new Date(item.providerPublishTime * 1000).toISOString()
        : new Date().toISOString();

      // Skip if no headline
      if (!headline) continue;

      let sentimentLabel = 'neutral';
      let sentimentScore = 0.5;
      let sentimentReason = 'Unable to analyze sentiment';

      // Call AI for sentiment analysis if OpenAI is available
      if (openai) {
        try {
          const prompt = `You are a financial news sentiment classifier for a trading application.

Your task is to analyze a single news article and classify the impact of the information on the related stock or market.

The sentiment MUST be one of:
- "bullish"
- "bearish"
- "neutral"

Your output MUST be valid JSON with this exact structure:
{
  "sentiment": "bullish" | "bearish" | "neutral",
  "confidence": number,      // 0.0–1.0
  "reason": "string"         // one short sentence
}

Rules:
1. Evaluate the article ONLY based on the information given.
2. Consider whether the article is likely to increase or decrease investor optimism.
3. Strong positive catalysts (earnings beats, product wins, upgrades) → bullish.
4. Strong negative catalysts (downgrades, scandals, losses, regulation) → bearish.
5. Mixed or uncertain information → neutral.
6. Confidence should reflect clarity:
   - 0.8–1.0 → strong, clear signal
   - 0.5–0.79 → moderate sentiment
   - 0.3–0.49 → weak, unclear sentiment
   - <0.3 → highly uncertain
7. NEVER include anything outside the JSON.
8. NEVER include explanations outside the JSON.
9. NEVER include sentiment stronger than warranted by the text.

Now analyze the article:

Headline: "${headline}"
Description: "${description || 'N/A'}"
Source: "${source}"
Published: "${published_at}"

Return ONLY the JSON.`;

          const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: 'You are a financial sentiment analyzer. Respond only with valid JSON.',
              },
              { role: 'user', content: prompt },
            ],
            temperature: 0.3,
            max_tokens: 150,
          });

          const responseText = completion.choices[0]?.message?.content?.trim() || '';
          
          // Try to parse JSON
          try {
            const analysis: SentimentAnalysis = JSON.parse(responseText);
            sentimentLabel = analysis.sentiment;
            sentimentScore = analysis.confidence;
            sentimentReason = analysis.reason;
          } catch (parseError) {
            console.warn(`[news_sentiment_analyzer] Failed to parse AI response:`, responseText);
            // Use basic keyword analysis as fallback
            const lowerText = (headline + ' ' + (description || '')).toLowerCase();
            if (lowerText.match(/surge|rally|soar|gain|bull|beat|profit|strong/)) {
              sentimentLabel = 'bullish';
              sentimentScore = 0.6;
              sentimentReason = 'Positive keywords detected';
            } else if (lowerText.match(/crash|plunge|fall|drop|bear|miss|loss|weak/)) {
              sentimentLabel = 'bearish';
              sentimentScore = 0.6;
              sentimentReason = 'Negative keywords detected';
            }
          }

          // Track costs and log usage
          aiCallCount++;
          const usage = completion.usage;
          if (usage) {
            const cost = ((usage.prompt_tokens || 0) / 1_000_000) * 0.15 +
                        ((usage.completion_tokens || 0) / 1_000_000) * 0.60;
            totalCost += cost;
          }
          
          // Log to ai_usage_logs
          await logOpenAiUsage(completion, userId || 'system', 'news_sentiment');

        } catch (aiError) {
          console.error(`[news_sentiment_analyzer] AI error:`, aiError);
          // Continue with neutral sentiment
        }
      } else {
        // No OpenAI key - use basic keyword analysis
        const lowerText = (headline + ' ' + (description || '')).toLowerCase();
        if (lowerText.match(/surge|rally|soar|gain|bull|beat|profit|strong/)) {
          sentimentLabel = 'bullish';
          sentimentScore = 0.6;
          sentimentReason = 'Positive keywords detected';
        } else if (lowerText.match(/crash|plunge|fall|drop|bear|miss|loss|weak/)) {
          sentimentLabel = 'bearish';
          sentimentScore = 0.6;
          sentimentReason = 'Negative keywords detected';
        }
      }

      analyzedArticles.push({
        headline,
        description,
        source,
        url,
        published_at,
        sentiment_label: sentimentLabel,
        sentiment_score: sentimentScore,
        sentiment_reason: sentimentReason,
      });

      // Insert into cache
      await supabase.from('news_cache').insert({
        symbol: normalizedSymbol,
        headline,
        description,
        source,
        url,
        published_at,
        sentiment_label: sentimentLabel,
        sentiment_score: sentimentScore,
        sentiment_reason: sentimentReason,
        raw_payload: item,
      });
    }

    console.log(`[news_sentiment_analyzer] Analyzed ${analyzedArticles.length} articles`);
    console.log(`[news_sentiment_analyzer] AI calls: ${aiCallCount}, Total cost: $${totalCost.toFixed(4)}`);

    // Log costs to ai_usage_logs if we made AI calls
    if (aiCallCount > 0 && totalCost > 0) {
      await supabase.from('ai_usage_logs').insert({
        user_id: 'system',
        model: 'gpt-4o-mini',
        task: 'news_sentiment',
        input_tokens: 0, // Aggregate tracked above
        output_tokens: 0,
        cost_usd: totalCost,
      });
    }

    // ============================================================
    // 4. APPLY PRO GATING AND RETURN RESULTS
    // ============================================================
    const gatedArticles = hasPro ? analyzedArticles : analyzedArticles.slice(0, 3); // Free: only 3 articles
    const overview = hasPro ? generateSentimentOverview(analyzedArticles) : undefined;

    return new Response(
      JSON.stringify({
        symbol: normalizedSymbol,
        articles: gatedArticles,
        overview,
        cached: false,
        access: {
          is_locked: !hasPro,
          total_articles: analyzedArticles.length,
          unlocked_articles: gatedArticles.length,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('[news_sentiment_analyzer] Error:', error);
    return new Response(
      JSON.stringify({
        error: 'internal_error',
        message: error.message || 'Unknown error occurred',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Generate aggregated sentiment overview from articles (PRO feature)
 */
function generateSentimentOverview(articles: NewsArticle[]): SentimentOverview {
  if (articles.length === 0) {
    return {
      overall_sentiment: 'neutral',
      sentiment_score: 0,
      bullish_count: 0,
      bearish_count: 0,
      neutral_count: 0,
      key_topics: [],
      market_impact: 'neutral',
    };
  }

  // Count sentiments
  const bullish_count = articles.filter(a => a.sentiment_label === 'bullish').length;
  const bearish_count = articles.filter(a => a.sentiment_label === 'bearish').length;
  const neutral_count = articles.filter(a => a.sentiment_label === 'neutral').length;

  // Calculate aggregate sentiment score (-1 to 1)
  const sentiment_score = (bullish_count - bearish_count) / articles.length;

  // Determine overall sentiment
  let overall_sentiment: 'bullish' | 'bearish' | 'neutral';
  if (sentiment_score > 0.2) {
    overall_sentiment = 'bullish';
  } else if (sentiment_score < -0.2) {
    overall_sentiment = 'bearish';
  } else {
    overall_sentiment = 'neutral';
  }

  // Extract key topics from headlines (simple keyword extraction)
  const topicKeywords = ['earnings', 'revenue', 'merger', 'acquisition', 'dividend', 
                         'lawsuit', 'regulation', 'fda', 'trial', 'partnership',
                         'guidance', 'outlook', 'growth', 'debt', 'buyback'];
  
  const key_topics: string[] = [];
  const allText = articles.map(a => (a.headline + ' ' + (a.description || '')).toLowerCase()).join(' ');
  
  for (const keyword of topicKeywords) {
    if (allText.includes(keyword) && key_topics.length < 5) {
      key_topics.push(keyword.charAt(0).toUpperCase() + keyword.slice(1));
    }
  }

  // Determine market impact
  const market_impact: 'positive' | 'negative' | 'neutral' = 
    sentiment_score > 0.3 ? 'positive' : 
    sentiment_score < -0.3 ? 'negative' : 
    'neutral';

  return {
    overall_sentiment,
    sentiment_score,
    bullish_count,
    bearish_count,
    neutral_count,
    key_topics,
    market_impact,
  };
}
