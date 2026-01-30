# Global Signals System

## Overview

The Global Signals System allows TradeSignals to be shared across all users, cached for 1 hour, and automatically posted to Discord when generated.

## Architecture

### Signal Sources

1. **Manual Requests** (User-initiated)
   - Triggered from Home screen in mobile app or Dashboard in web app
   - Stored in `ai_signals` table with `is_manual_request = true`
   - Posted to Discord once when created
   - Cached for 1 hour for all users

2. **Hourly Auto-Generation** (Cron job)
   - Runs via `hourly_generate_signals` Edge Function
   - Stored in `ai_signals` table with `is_manual_request = false`
   - Posted to Discord in batch summary
   - Same 1-hour cache applies

### Cache Behavior

**Rule: < 1 Hour = Cached**
- If a signal for `(symbol, timeframe)` exists and `updated_at` is < 60 minutes ago
- Return cached signal immediately
- No new AI/API calls
- No Discord notification
- Response includes `is_cached: true` and `cache_age_minutes`

**Rule: ≥ 1 Hour = Fresh Generation**
- If no signal exists OR `updated_at` is ≥ 60 minutes ago
- Generate new signal using full Phase 2 pipeline
- Store in database (upsert on `symbol, timeframe`)
- Post to Discord (for manual requests)
- Response includes `is_cached: false` and `cache_age_minutes: 0`

### Database Schema

**Table: `ai_signals`**

Key columns for Global Signals System:
```sql
- id UUID PRIMARY KEY
- symbol TEXT NOT NULL
- timeframe TEXT NOT NULL
- signal_type TEXT (buy|sell|neutral)
- confidence_score NUMERIC(5,2)
- entry_price NUMERIC(12,4)
- stop_loss NUMERIC(12,4)
- take_profit_1 NUMERIC(12,4)
- take_profit_2 NUMERIC(12,4)
- reasoning TEXT
- is_manual_request BOOLEAN DEFAULT false
- cached_source BOOLEAN DEFAULT false
- created_at TIMESTAMPTZ
- updated_at TIMESTAMPTZ
```

**Unique constraint**: `(symbol, timeframe)` per day via `idx_ai_signals_unique_daily`

## Implementation Details

### Backend (Edge Functions)

#### `request_tradesignal/index.ts`

Main entry point for manual signal requests.

**Flow:**
1. Validate input (`symbol`, `timeframe`)
2. Check cache:
   ```typescript
   SELECT * FROM ai_signals 
   WHERE symbol = ? AND timeframe = ?
   ORDER BY updated_at DESC LIMIT 1
   ```
3. If found and `age < 60 min`:
   - Return cached signal
   - Set `is_cached: true`
4. If not found or `age >= 60 min`:
   - Call `assembleRawSignalInput()` - fetches OHLCV, news, SMC data
   - Call `computeRuleSignal()` - rule-based analysis
   - Call `evaluateSignalWithAI()` - AI refinement
   - Call `signalToRow()` with `is_manual_request: true`
   - Upsert to `ai_signals`
   - Call `sendDiscordSignalNotification(signal, 'manual')`
   - Return fresh signal with `is_cached: false`

**API:**
```typescript
POST /functions/v1/request_tradesignal
Body: {
  symbol: string,      // e.g. "AAPL"
  timeframe: string,   // "15m" | "1H" | "4H" | "1D"
  user_id?: string,
  force_refresh?: boolean
}

Response: {
  id: string,
  symbol: string,
  timeframe: string,
  signal_type: "buy" | "sell" | "neutral",
  confidence_score: number,
  entry_price: number,
  stop_loss: number,
  take_profit_1: number,
  reasoning: string,
  is_cached: boolean,
  cache_age_minutes: number,
  is_manual_request: boolean,
  created_at: string,
  updated_at: string,
  // ... other fields
}
```

#### `_shared/discord_signals_notifier.ts`

Discord notification helper for new signals.

**Function:**
```typescript
sendDiscordSignalNotification(signal: AISignalRow, source: 'manual' | 'hourly')
```

**Discord Embed Format:**
- Title: `👤 MANUAL AAPL 1H` or `🤖 AUTO AAPL 1H`
- Fields: Signal type, confidence, entry/SL/TP, breakdown scores
- Color-coded: Green (buy), Red (sell), Gray (neutral)
- Non-blocking: failures logged but don't break signal generation

**Environment Variable:**
- `DISCORD_SIGNALS_WEBHOOK` - Discord webhook URL (optional)
- Falls back to `DISCORD_ALERT_WEBHOOK_URL` if not set
- If both are unset, Discord notifications are skipped (non-blocking)

#### `_shared/signal_types.ts`

Updated `signalToRow()` function:
```typescript
export function signalToRow(
  signal: EvaluatedSignal, 
  is_manual_request = false
): Omit<AISignalRow, 'id' | 'created_at' | 'updated_at'>
```

### Frontend (Web App)

#### `/app/api/tradesignal/request/route.ts`

Web app API route that proxies to Edge Function.

**Flow:**
1. Validate user session
2. Check subscription tier (trial or pro)
3. Call `supabase.functions.invoke('request_tradesignal', ...)`
4. Return Edge Function response directly

**Client Usage:**
```typescript
const response = await fetch('/api/tradesignal/request', {
  method: 'POST',
  body: JSON.stringify({
    symbol: 'AAPL',
    timeframe: '1H'
  })
});

const data = await response.json();
// data.is_cached -> boolean
// data.cache_age_minutes -> number
// data.signal_type -> "buy" | "sell" | "neutral"
```

### Mobile App (Flutter)

**No backend changes needed** - the Edge Function is already wired up.

**Recommended UI Updates:**

1. **Signals Tab**: Add badge to indicate Fresh vs Expired
   ```dart
   bool get isFresh => DateTime.now().difference(updatedAt).inMinutes < 60;
   int get ageMinutes => DateTime.now().difference(updatedAt).inMinutes;
   ```

2. **Signal Card UI**:
   - Fresh: `🟢 Fresh • 12m ago`
   - Expired: `⚪ Expired • 2h ago`

3. **Cache Indicator**: Show when displaying a cached signal
   ```dart
   if (isCached) {
     Text('Using latest signal (cached, ${ageMinutes}m old)')
   }
   ```

## Testing

### Test Scenario 1: New Signal Generation

1. Clear any existing signal for test symbol:
   ```sql
   DELETE FROM ai_signals WHERE symbol = 'AAPL' AND timeframe = '1h';
   ```

2. Call Edge Function:
   ```bash
   curl -X POST https://your-project.supabase.co/functions/v1/request_tradesignal \
     -H "Authorization: Bearer YOUR_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"symbol": "AAPL", "timeframe": "1h"}'
   ```

3. Verify:
   - Response has `is_cached: false`
   - Row inserted in `ai_signals` with `is_manual_request: true`
   - Discord message posted with "👤 MANUAL AAPL 1H"

### Test Scenario 2: Cached Signal

1. Immediately call the same endpoint again:
   ```bash
   curl -X POST https://your-project.supabase.co/functions/v1/request_tradesignal \
     -H "Authorization: Bearer YOUR_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"symbol": "AAPL", "timeframe": "1h"}'
   ```

2. Verify:
   - Response has `is_cached: true`
   - `cache_age_minutes` is > 0 and < 60
   - No new row inserted
   - No Discord message posted

### Test Scenario 3: Cache Expiration

1. Wait 60+ minutes or manually update the signal:
   ```sql
   UPDATE ai_signals 
   SET updated_at = updated_at - INTERVAL '61 minutes'
   WHERE symbol = 'AAPL' AND timeframe = '1h';
   ```

2. Call endpoint again

3. Verify:
   - Response has `is_cached: false`
   - Row updated in database (new `updated_at`)
   - New Discord message posted

### Test Scenario 4: Hourly Cron (Unchanged)

1. Trigger `hourly_generate_signals` manually or wait for cron

2. Verify:
   - Signals generated for TARGET_SYMBOLS
   - Stored with `is_manual_request: false`
   - Discord summary posted (existing format, unchanged)

## Monitoring

### Logs

Check Edge Function logs for:
```
[Cache HIT] AAPL/1h - 23.4min old
[Cache MISS] AAPL/1h - 65.2min old (stale)
[Discord] ✓ Posted AAPL 1h signal (manual)
```

### Metrics to Track

1. **Cache Hit Rate**:
   ```sql
   SELECT 
     COUNT(*) FILTER (WHERE is_cached = true) * 100.0 / COUNT(*) AS cache_hit_rate
   FROM request_logs
   WHERE created_at > NOW() - INTERVAL '24 hours';
   ```

2. **Manual vs Auto Signals**:
   ```sql
   SELECT 
     is_manual_request,
     COUNT(*),
     AVG(confidence_score)
   FROM ai_signals
   WHERE created_at > NOW() - INTERVAL '7 days'
   GROUP BY is_manual_request;
   ```

3. **Fresh vs Expired Signals**:
   ```sql
   SELECT 
     symbol,
     timeframe,
     EXTRACT(EPOCH FROM (NOW() - updated_at)) / 60 AS age_minutes
   FROM ai_signals
   ORDER BY updated_at DESC;
   ```

## Configuration

### Environment Variables

**Optional:**
- `DISCORD_SIGNALS_WEBHOOK` - Discord webhook URL for signal notifications (if not set, uses `DISCORD_ALERT_WEBHOOK_URL`)

**Existing (unchanged):**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` (for AI evaluation)
- `FINNHUB_API_KEY` (for fundamentals)
- `FMP_API_KEY` (for fundamentals fallback)

### Deployment Checklist

- [ ] Set `DISCORD_SIGNALS_WEBHOOK` in Supabase Edge Functions environment
- [ ] Deploy `request_tradesignal` Edge Function
- [ ] Deploy `_shared/discord_signals_notifier.ts`
- [ ] Deploy `_shared/signal_types.ts` (updated)
- [ ] Deploy web app API route updates
- [ ] Test new signal generation
- [ ] Test cache behavior
- [ ] Verify Discord notifications
- [ ] Update mobile app UI (optional, non-blocking)

## FAQ

**Q: Do manual signals replace hourly signals?**  
A: No. Both coexist in the same `ai_signals` table. Manual signals have `is_manual_request = true`, hourly have `false`.

**Q: What happens if two users request the same symbol at the same time?**  
A: First request generates the signal. Second request (within 1 hour) gets cached response. Only one Discord notification is sent.

**Q: Can a user force refresh a cached signal?**  
A: Not yet implemented. Future enhancement: Add `force_refresh` parameter to bypass cache (PRO only).

**Q: What if Discord is down?**  
A: Discord failures are non-blocking and logged. The signal is still generated and stored in the database.

**Q: How do expired signals get cleaned up?**  
A: They don't. Signals remain as history. Future enhancement: Archive signals older than 30 days.

**Q: Does this work for mobile app?**  
A: Yes. The backend changes apply to both web and mobile. Mobile app just needs UI updates to show Fresh/Expired labels.

## Migration Path

If you're adding this to an existing system:

1. **No migration needed** - all columns already exist
2. Existing signals have `is_manual_request = NULL` → treated as hourly
3. Existing signals without `updated_at` → use `created_at` as fallback
4. Deploy backend first, then frontend
5. Mobile app continues to work without updates (UI enhancements optional)
