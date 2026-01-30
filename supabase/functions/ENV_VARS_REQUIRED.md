# TradeLens Edge Functions - Required Environment Variables

## Critical (Required)

These environment variables **MUST** be set in Supabase for the Edge Functions to work:

### `OPENAI_API_KEY`
**Required for:** All TradeSignal generation (AI evaluation)
**Where:** OpenAI API Dashboard (https://platform.openai.com/api-keys)
**Used by:**
- `request_tradesignal`
- `admin_ai_generate_signals`
- `hourly_generate_signals`
- All AI-powered functions

**Error if missing:** "Failed to generate TradeSignal" - AI evaluation will fail

### `SUPABASE_URL`
**Required for:** All functions (database access)
**Auto-set:** Yes (Supabase provides this automatically)

### `SUPABASE_SERVICE_ROLE_KEY`
**Required for:** All functions (database access with elevated privileges)
**Auto-set:** Yes (Supabase provides this automatically)
### `APCA_API_KEY_ID` and `APCA_API_SECRET_KEY`
**Required for:** Alpaca REST + WebSocket market-data feed (realtime quotes shared by engines and monitors)\
**Where:** https://app.alpaca.markets/broker/api-keys \
**Used by:**
- `_shared/alpaca_market_data.ts` (snapshot fetch + WebSocket auth)
- Upcoming Alpaca stream worker / cron functions
- `live_position_monitor` (reads from `realtime_market_data` that Alpaca populates)

**Error if missing:** Any Alpaca call will throw `Missing APCA_API_KEY_ID or APCA_API_SECRET_KEY`.

---

## Optional (Recommended)

These improve data quality but functions will work without them (with fallbacks):

### `FINNHUB_API_KEY`
**Recommended for:** Fundamental data (PE ratio, EPS, market cap, etc.)
**Where:** Finnhub.io (https://finnhub.io/)
**Fallback:** Uses FMP if available, or skips fundamentals
**Used by:**
- `request_tradesignal`
- `admin_ai_generate_signals`
- `hourly_generate_signals`

### `FMP_API_KEY`
**Recommended for:** Fundamental data (fallback from Finnhub)
**Where:** Financial Modeling Prep (https://financialmodelingprep.com/)
**Fallback:** Skips fundamentals if both FINNHUB and FMP are missing
**Used by:**
- `request_tradesignal`
- `admin_ai_generate_signals`
- `hourly_generate_signals`

### `NEWS_API_KEY`
**Recommended for:** News sentiment analysis
**Where:** NewsAPI.org (https://newsapi.org/)
**Fallback:** Sentiment analysis will be empty/neutral
**Used by:**
- `request_tradesignal`
- `admin_ai_generate_signals`
- `hourly_generate_signals`
- `news_sentiment_analyzer`

### `APCA_API_BASE_URL` / `APCA_DATA_WS_URL`
**Optional:** Override Alpaca REST (`APCA_API_BASE_URL`, default `https://data.alpaca.markets/v2`) and WebSocket (`APCA_DATA_WS_URL`, default `wss://stream.data.alpaca.markets/v2/iex`) endpoints if you are on a premium plan (SIP feed) or sandbox.
**Used by:** `_shared/alpaca_market_data.ts` for snapshot + streaming clients.

### `REALTIME_MAX_SYMBOLS` / `REALTIME_CHUNK_SIZE`
**Optional:** Controls how many tickers `update_realtime_quotes` ingests per run and how large each Alpaca snapshot batch is. Defaults: `REALTIME_MAX_SYMBOLS=400`, `REALTIME_CHUNK_SIZE=50`.
**Used by:** `supabase/functions/update_realtime_quotes`

### `REALTIME_MAX_AGE_MS`
**Optional:** Milliseconds before a `realtime_market_data` row is considered stale when engines call `fetchCurrentQuote`. Defaults to `90000` (90 seconds).
**Used by:** `_shared/signal_data_fetcher.ts`

### `FOCUS_MAX_TICKERS` / `FOCUS_MIN_CONFIDENCE`
**Optional:** Controls how many symbols the pre-market sweep keeps each day and the minimum confidence threshold for inclusion. Defaults: `FOCUS_MAX_TICKERS=30`, `FOCUS_MIN_CONFIDENCE=60`.
**Used by:** `pre_market_active_symbols` (writes `daily_focus_tickers`), hourly signal jobs consume the resulting list.

### Focus Universe V2 (optional, defaults provided)
- `FOCUS_PRIMARY_MIN_CONFIDENCE` (default 55)
- `FOCUS_MOMENTUM_MIN_CONFIDENCE` (default 48)
- `FOCUS_MOMENTUM_MAX_CONFIDENCE` (default 54)
- `FOCUS_LOOKBACK_HOURS` (default 24)
- `FOCUS_MAX_TICKERS` (default 30)
- `MIN_FOCUS_SIZE` (default 25)
- `FOCUS_MISSED_LIST_SIZE` (default 20)
- `FOCUS_VOLATILITY_GATE_MODE` one of LIST|ATR_PCT|HYBRID (default HYBRID)
- `FOCUS_VOLATILITY_TICKER_LIST` comma list, default: MARA,NIO,RIOT,COIN,TSLA,NVDA,PLTR,SOFI,TNA,LABU,SHOP,AFRM,DKNG
- `FOCUS_ATR_PERCENTILE_MIN` (default 0.70)
- `FOCUS_ATR_LOOKBACK_DAYS` (default 14)
- `FOCUS_ENABLE_DB_AUDIT` (default true)
- `FOCUS_ENABLE_VERBOSE_LOGS` (default true)

---

## Discord Webhooks (Optional)

### `DISCORD_SIGNALS_WEBHOOK`
**Optional:** For posting signals to Discord
**Where:** Discord Server Settings → Integrations → Webhooks
**Used by:**
- `request_tradesignal` (posts manual user requests)
- `hourly_generate_signals` (posts automated signals)

**If missing:** Signals will still generate, but won't post to Discord

---

## Stripe (Payment Processing)

### `STRIPE_SECRET_KEY`
**Required for:** Subscription management
**Where:** Stripe Dashboard (https://dashboard.stripe.com/apikeys)
**Used by:**
- `admin_stripe_webhook`
- Payment/subscription functions

---

## How to Set Environment Variables

### In Supabase Dashboard:
1. Go to https://supabase.com/dashboard/project/gwacnidnscugvwxhchsm/settings/functions
2. Click "Environment Variables"
3. Add each variable with its value
4. Click "Save"
5. Redeploy functions for changes to take effect

### Via Supabase CLI:
```bash
# Set a single variable
supabase secrets set OPENAI_API_KEY=sk-...

# Set multiple variables from file
supabase secrets set --env-file .env.local
```

---

## Current Status Check

To verify which variables are set:

```bash
# List all secrets (values are hidden)
supabase secrets list
```

---

## Troubleshooting

### "Failed to generate TradeSignal"
**Most likely cause:** Missing `OPENAI_API_KEY`
**Check:** Supabase Dashboard → Settings → Edge Functions → Secrets

### "Data fetch failed"
**Possible causes:**
- Invalid stock symbol
- Yahoo Finance API temporarily down
- Network issues

**Not caused by:** Missing FINNHUB/FMP/NEWS_API keys (these are optional)

### "AI evaluation failed"
**Most likely cause:** Missing `OPENAI_API_KEY`
**Other causes:**
- OpenAI API rate limit exceeded
- Invalid API key
- OpenAI service outage

---

## Deployment Checklist

Before deploying to production:

- [ ] `OPENAI_API_KEY` is set (CRITICAL)
- [ ] `SUPABASE_URL` is set (auto-set by Supabase)
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is set (auto-set by Supabase)
- [ ] `FINNHUB_API_KEY` is set (recommended)
- [ ] `FMP_API_KEY` is set (recommended)
- [ ] `NEWS_API_KEY` is set (recommended)
- [ ] `DISCORD_SIGNALS_WEBHOOK` is set (optional)
- [ ] `STRIPE_SECRET_KEY` is set (if using payments)

---

## Cost Estimates

### OpenAI (gpt-4o)
- **Per signal:** ~$0.01 - $0.02
- **1000 signals/month:** ~$10 - $20

### Finnhub (Free Tier)
- **60 API calls/minute**
- **Cost:** Free

### FMP (Free Tier)
- **250 API calls/day**
- **Cost:** Free

### NewsAPI (Free Tier)
- **100 requests/day**
- **Cost:** Free

---

**Last Updated:** 2025-11-29
**Maintained By:** TradeLens Development Team
