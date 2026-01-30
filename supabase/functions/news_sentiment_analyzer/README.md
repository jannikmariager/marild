# News Sentiment Analyzer

AI-powered news sentiment analysis engine for TradeLens.

## Overview

The News Sentiment Analyzer fetches financial news from Yahoo Finance, analyzes sentiment using OpenAI GPT-4o-mini, and caches results in the `news_cache` database table.

## Features

- **Smart Caching**: Reuses existing sentiment analysis for 15 minutes
- **AI-Powered**: Uses OpenAI gpt-4o-mini for accurate sentiment classification
- **Fallback**: Keyword-based sentiment when OpenAI is unavailable
- **Cost Tracking**: Logs all AI costs to `ai_usage_logs` table
- **Flexible**: Supports symbol-specific or global market news

## API Endpoint

```
POST /functions/v1/news_sentiment_analyzer
```

### Request Body

```json
{
  "symbol": "NVDA",  // Optional: stock ticker (null for global news)
  "limit": 20        // Optional: max articles (default 20, max 50)
}
```

### Response

```json
{
  "symbol": "NVDA",
  "articles": [
    {
      "headline": "NVIDIA Announces New AI Chip",
      "description": "The semiconductor giant unveils...",
      "source": "Reuters",
      "url": "https://...",
      "published_at": "2025-11-29T20:30:00Z",
      "sentiment_label": "bullish",
      "sentiment_score": 0.92,
      "sentiment_reason": "Positive product announcement with market impact"
    }
  ],
  "cached": false
}
```

## Sentiment Classification

### Labels
- **bullish**: Positive market sentiment
- **bearish**: Negative market sentiment  
- **neutral**: No clear directional bias

### Score
Confidence level from 0.0 to 1.0

### Reason
Brief AI-generated explanation for the sentiment classification

## Caching Strategy

### Cache TTL: 15 minutes

**Cache Hit**:
- Returns existing articles from `news_cache`
- No API calls, no AI costs
- Minimum 5 articles required for cache hit

**Cache Miss**:
- Fetches fresh news from Yahoo Finance
- Analyzes sentiment with AI
- Stores results in `news_cache`
- Logs costs to `ai_usage_logs`

## Cost Control

- **Max articles**: 50 per request
- **Model**: gpt-4o-mini ($0.15/M input, $0.60/M output)
- **Average cost per article**: ~$0.0001 - $0.0003
- **Cache savings**: 100% cost reduction for repeated requests within 15 min

## Database Schema

### news_cache Table

```sql
CREATE TABLE news_cache (
  id uuid PRIMARY KEY,
  symbol text,                  -- nullable for global news
  headline text NOT NULL,
  description text,
  source text,
  url text,
  published_at timestamptz,
  sentiment_label text,         -- 'bullish' | 'bearish' | 'neutral'
  sentiment_score numeric,      -- 0.0–1.0
  sentiment_reason text,        -- AI explanation
  raw_payload jsonb,            -- original Yahoo data
  created_at timestamptz DEFAULT now()
);
```

### Indexes

- `idx_news_cache_symbol_published`: Fast lookup by symbol + date
- `idx_news_cache_published`: Global news queries
- `idx_news_cache_sentiment`: Sentiment filtering

### RLS Policies

- **Authenticated users**: Read access
- **Service role**: Full access

## Integration Points

### Web App
- `/api/news` route uses sentiment analyzer
- Displays sentiment badges in news feed
- 15-minute cache control headers

### Mobile App
- Direct Edge Function calls
- Symbol-specific news with sentiment

### TradeSignal Engine
- Incorporate news sentiment into signal scoring
- Weight recent sentiment in analysis

### Admin Dashboard
- View sentiment distribution by symbol
- Track sentiment trends over time
- Monitor AI costs per symbol

### Discord
- Post high-impact news with sentiment
- Alert on extreme sentiment shifts

## Testing

### Manual Test

```bash
./test_news_sentiment.sh NVDA
```

### Supabase Dashboard

1. Go to Edge Functions
2. Select `news_sentiment_analyzer`
3. Test with payload:
   ```json
   {
     "symbol": "NVDA",
     "limit": 5
   }
   ```

### Web App

Navigate to `/news` page - should display sentiment-analyzed articles.

## Fallback Behavior

If OpenAI API key is not available, the function falls back to keyword-based sentiment:

**Bullish keywords**: surge, rally, soar, gain, bull, beat, profit, strong  
**Bearish keywords**: crash, plunge, fall, drop, bear, miss, loss, weak

Fallback confidence: 0.6 (medium confidence)

## Monitoring

### Logs
- Check Supabase Edge Function logs for errors
- Monitor AI call counts and costs

### Database
- Query `news_cache` for cache hit rate
- Query `ai_usage_logs` for cost tracking

### Performance
- Average response time: 2-5s (fresh) / 100-300ms (cached)
- Yahoo Finance API: ~500ms
- OpenAI API: ~1-3s per article

## Future Enhancements

1. **Batch AI calls**: Analyze multiple articles in single prompt
2. **Sentiment aggregation**: Daily/weekly sentiment scores per symbol
3. **Anomaly detection**: Alert on sudden sentiment shifts
4. **News sources**: Add more providers (Finnhub, NewsAPI, Alpha Vantage)
5. **Historical sentiment**: Track sentiment trends over time
6. **Entity extraction**: Identify mentioned tickers in global news
