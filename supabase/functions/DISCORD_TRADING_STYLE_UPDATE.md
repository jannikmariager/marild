# Discord Signal Posting - Trading Style Integration

## Overview
Updated Discord signal notifications to include trading style information (Daytrade / Swingtrade / Investing) for all signals, whether manually requested or auto-generated.

## Changes Implemented

### 1. Database Schema
**File:** `migrations/20251129_add_trading_style.sql`

Added `trading_style` column to `ai_signals` table:
- Type: TEXT with CHECK constraint (`daytrade`, `swing`, `invest`)
- Default: `swing`
- Indexed for query performance
- Backfilled existing rows based on timeframe

### 2. TypeScript Types
**File:** `_shared/signal_types.ts`

**Updated:**
- `AISignalRow` interface - Added `trading_style?: 'daytrade' | 'swing' | 'invest'`
- `EvaluatedSignal` interface - Added `trading_style?: 'daytrade' | 'swing' | 'invest'`
- `signalToRow()` helper - Includes `trading_style` in output
- **New helper:** `determineTradingStyle(timeframe)` - Maps timeframe to trading style

**Mapping:**
```typescript
'5m' | '15m' | '1h' → 'daytrade'
'4h'                → 'swing'
'1d' | '1w'         → 'invest'
```

### 3. Discord Notifier
**File:** `_shared/discord_signals_notifier.ts`

**Updated:**
- Now uses `signal.trading_style` field from database
- Falls back to `determineTradingStyle(signal.timeframe)` if not set
- Removed duplicate helper function (now imported from signal_types.ts)

**Discord Display:**
- Field name: "🎯 Trading Style"
- Labels: "⚡ Daytrade", "🔁 Swingtrade", "🏦 Investing"
- Shown in embed fields alongside Signal, Confidence, and Risk

### 4. Edge Functions

#### request_tradesignal
**File:** `request_tradesignal/index.ts`

**Changes:**
- Added `trading_style?: 'daytrade' | 'swing' | 'invest'` to request interface
- Determines trading style from request OR derives from timeframe
- Cache lookup now includes `trading_style` filter (prevents mixing styles)
- Adds `trading_style` to evaluated signal before storage
- Returns `trading_style` in API response

**Cache Behavior:**
```
AAPL 1H Daytrade ≠ AAPL 1H Swing
```
Different trading styles are cached separately even for same symbol/timeframe.

#### admin_ai_generate_signals
**File:** `admin_ai_generate_signals/index.ts`

**Changes:**
- Determines trading style from timeframe using `determineTradingStyle()`
- Adds `trading_style` to evaluated signal before storage
- Auto-generated signals default to timeframe-based trading style

### 5. Signal Sources

**Discord now shows source label:**
- `👤 MANUAL` - User-requested signals
- `🤖 AUTO` - Automated/scheduled signals

## Discord Embed Example

```
👤 MANUAL AAPL 1H
Swingtrade Signal Generated

📊 Signal: 🟢 BUY
🎯 Trading Style: 🔁 Swingtrade
⚡ Confidence: 78%
⚠️ Correction Risk: 35%
🔗 Confluence: 65%
💰 Trade Setup: Entry: $175.25 • Stop: $172.80 • Target: $180.50
📝 Summary: Strong bullish structure with demand zone respected...
```

## Testing Checklist

- [x] Database migration adds `trading_style` column
- [x] TypeScript types updated with `trading_style`
- [x] Discord notifier uses `trading_style` field
- [x] `request_tradesignal` accepts and stores `trading_style`
- [x] Cache respects trading style (separate caches per style)
- [x] `admin_ai_generate_signals` includes trading style
- [x] Manual signals show correct style in Discord
- [x] Auto signals show correct style in Discord

## Test Cases

### 1. Manual Request - Daytrade
**Request:**
```json
{
  "symbol": "NVDA",
  "timeframe": "1h",
  "trading_style": "daytrade"
}
```

**Expected Discord:**
- Title: "👤 MANUAL NVDA 1H"
- Trading Style: "⚡ Daytrade"
- Source: "User Request"

### 2. Manual Request - Swing
**Request:**
```json
{
  "symbol": "AAPL",
  "timeframe": "4h",
  "trading_style": "swing"
}
```

**Expected Discord:**
- Title: "👤 MANUAL AAPL 4H"
- Trading Style: "🔁 Swingtrade"
- Source: "User Request"

### 3. Auto-Generated - Investing
**Trigger:** Daily scheduled job with `timeframe: "1d"`

**Expected Discord:**
- Title: "🤖 AUTO TSLA 1D"
- Trading Style: "🏦 Investing"
- Source: "Automated Scan"

### 4. Cache Behavior
**Scenario:** User requests AAPL 1H with different trading styles

```
Request 1: AAPL 1H daytrade → Generates new signal A
Request 2: AAPL 1H swing    → Generates new signal B (not cached from A)
Request 3: AAPL 1H daytrade → Returns cached signal A (< 1 hour old)
```

## Benefits

1. **Better Context**: Users see whether signal is for day trading, swing trading, or investing
2. **Proper Caching**: Prevents mixing signals intended for different trading styles
3. **Clear Communication**: Discord shows exactly what type of trade is being suggested
4. **AI Optimization**: Future AI can weight factors differently per trading style
5. **User Preferences**: Can match signals to user's preferred trading style

## Migration Path

### For Existing Data
The migration backfills `trading_style` for all existing signals based on timeframe:
```sql
UPDATE ai_signals
SET trading_style = CASE
  WHEN LOWER(timeframe) IN ('5m', '15m', '1h') THEN 'daytrade'
  WHEN LOWER(timeframe) = '4h' THEN 'swing'
  ELSE 'invest'
END
WHERE trading_style IS NULL;
```

### For New Deployments
1. Run migration: `20251129_add_trading_style.sql`
2. Deploy updated Edge Functions
3. Verify Discord webhook still works
4. Test manual signal request with trading_style param
5. Verify cached signals respect trading_style filter

## Rollback Plan

If issues arise:
1. Discord notifier falls back to timeframe-based style (no database dependency)
2. Edge Functions still work without `trading_style` param (defaults to timeframe)
3. Can revert migration if needed (column is nullable and has default)

## Next Steps

- [ ] Update web app to pass `trading_style` in requests (already done)
- [ ] Update mobile app to pass `trading_style` in requests
- [ ] Consider AI weighting based on trading_style (future enhancement)
- [ ] Add trading_style filter to admin dashboard
