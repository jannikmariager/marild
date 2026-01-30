# Smart Money Concepts (SMC) Backend Engine

Complete backend implementation for Smart Money Concepts analysis with Order Blocks, Break of Structure detection, and AI-powered trade setups.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Flutter App (Frontend)                    │
│  SMCService → Calls Supabase Edge Functions                 │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│              Supabase Edge Functions (Backend)               │
│  1. smc_calculate_levels  - Calculate OB/BOS/Sessions       │
│  2. smc_get_levels        - Fetch SMC data (read-only)      │
│  3. smc_get_trade_setups  - AI-powered trade generation     │
└─────────────────────┬───────────────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────────────┐
│                  Postgres Database Tables                    │
│  • smc_order_blocks      - Bullish/Bearish OBs              │
│  • smc_bos_events        - Break of Structure events        │
│  • smc_session_ranges    - NY/London/Asia sessions          │
│  • smc_trade_setups      - AI trade recommendations         │
└──────────────────────────────────────────────────────────────┘
```

## Edge Functions

### 1. `smc_calculate_levels`

**Purpose:** Calculate Smart Money Concepts levels from historical price data.

**Input:**
```json
{
  "ticker": "AAPL",
  "timeframe": "1h"
}
```

**Timeframes:** `5m`, `15m`, `1h`, `4h`, `1d`

**Output:**
```json
{
  "success": true,
  "ticker": "AAPL",
  "timeframe": "1h",
  "stats": {
    "order_blocks": 12,
    "bos_events": 8,
    "sessions": 3,
    "bars_processed": 720
  }
}
```

**Algorithm:**
1. Fetch OHLC data from Yahoo Finance via `get_chart`
2. Detect swing highs/lows (5-bar lookback)
3. Identify Break of Structure (BOS):
   - BOS Up = close above previous swing high
   - BOS Down = close below previous swing low
4. Detect Order Blocks:
   - Bullish OB = last down candle before BOS up
   - Bearish OB = last up candle before BOS down
5. Mark origin OBs (first OB in trend)
6. Calculate mitigation (price closed through OB)
7. Calculate session ranges (NY, PREV_DAY, PREV_4H, PREV_1H)
8. Store results in Postgres

**Example cURL:**
```bash
curl -X POST 'https://[project].supabase.co/functions/v1/smc_calculate_levels' \
  -H 'Authorization: Bearer [anon_key]' \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"AAPL","timeframe":"1h"}'
```

---

### 2. `smc_get_levels`

**Purpose:** Fetch latest SMC data (read-only).

**Input:**
```json
{
  "ticker": "AAPL",
  "timeframe": "1h"
}
```

**Output:**
```json
{
  "ticker": "AAPL",
  "timeframe": "1h",
  "order_blocks": [
    {
      "id": "uuid",
      "direction": "bullish",
      "high": 178.50,
      "low": 177.20,
      "open_time": "2025-11-28T10:00:00Z",
      "close_time": "2025-11-28T11:00:00Z",
      "mitigated": false,
      "mitigation_time": null,
      "origin": true,
      "created_at": "2025-11-28T12:00:00Z"
    }
  ],
  "bos_events": [
    {
      "id": "uuid",
      "direction": "up",
      "price": 179.80,
      "event_time": "2025-11-28T11:30:00Z",
      "strength": 0.82
    }
  ],
  "sessions": [
    {
      "session_type": "PREV_DAY",
      "high": 180.00,
      "low": 176.00,
      "open_time": "2025-11-27T09:30:00Z",
      "close_time": "2025-11-27T16:00:00Z",
      "session_date": "2025-11-27"
    }
  ],
  "ai_summary": "AAPL has 3 active bullish order blocks...",
  "updated_at": "2025-11-28T12:00:00Z"
}
```

**Example cURL:**
```bash
curl -X POST 'https://[project].supabase.co/functions/v1/smc_get_levels' \
  -H 'Authorization: Bearer [anon_key]' \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"AAPL","timeframe":"1h"}'
```

---

### 3. `smc_get_trade_setups`

**Purpose:** Generate AI-powered trade setups with entry, stop loss, take profit.

**Input:**
```json
{
  "ticker": "AAPL",
  "timeframe": "1h",
  "user_tier": "pro"
}
```

**User Tiers:**
- `free`: Returns cached setups (max 10 min old)
- `pro`: Generates fresh AI analysis

**Output:**
```json
{
  "ticker": "AAPL",
  "timeframe": "1h",
  "setups": [
    {
      "id": "uuid",
      "side": "long",
      "entry": 177.85,
      "stop_loss": 176.90,
      "take_profit": 180.70,
      "risk_reward": 3.0,
      "confidence": 0.72,
      "rationale": "AAPL is reacting from a fresh bullish 1H order block at 177.20-178.50. Price shows bullish momentum after a BOS up at 179.80. This represents a high-probability entry with a 3:1 risk-reward ratio.",
      "source_ob_id": "uuid",
      "created_at": "2025-11-28T12:00:00Z"
    },
    {
      "id": "uuid",
      "side": "short",
      "entry": 182.00,
      "stop_loss": 183.20,
      "take_profit": 178.40,
      "risk_reward": 3.0,
      "confidence": 0.64,
      "rationale": "A bearish order block formed after BOS down...",
      "source_ob_id": "uuid",
      "created_at": "2025-11-28T12:00:00Z"
    }
  ],
  "cached": false
}
```

**AI Integration:**
- Uses OpenAI `gpt-4o-mini` for rationale generation
- Analyzes OB context, BOS direction, and price structure
- Returns confidence score (0-1) and detailed reasoning
- Fallback logic if OpenAI unavailable

**Example cURL:**
```bash
curl -X POST 'https://[project].supabase.co/functions/v1/smc_get_trade_setups' \
  -H 'Authorization: Bearer [anon_key]' \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"AAPL","timeframe":"1h","user_tier":"pro"}'
```

---

## Database Schema

### `smc_order_blocks`
```sql
- id (uuid, primary key)
- ticker (text, indexed)
- timeframe (text, indexed)
- direction ('bullish' | 'bearish')
- high (double precision)
- low (double precision)
- open_time (timestamptz)
- close_time (timestamptz)
- mitigated (boolean, default false)
- mitigation_time (timestamptz, nullable)
- origin (boolean, default false)
- created_at (timestamptz, default now())
```

### `smc_bos_events`
```sql
- id (uuid, primary key)
- ticker (text, indexed)
- timeframe (text, indexed)
- direction ('up' | 'down')
- price (double precision)
- event_time (timestamptz)
- strength (double precision, 0-1)
- created_at (timestamptz, default now())
```

### `smc_session_ranges`
```sql
- id (uuid, primary key)
- ticker (text, indexed)
- session_date (date, indexed)
- session_type ('NY' | 'LONDON' | 'ASIA' | 'PREV_DAY' | 'PREV_4H' | 'PREV_1H')
- high (double precision)
- low (double precision)
- open_time (timestamptz)
- close_time (timestamptz)
- created_at (timestamptz, default now())
```

### `smc_trade_setups`
```sql
- id (uuid, primary key)
- ticker (text, indexed)
- timeframe (text, indexed)
- side ('long' | 'short')
- entry (double precision)
- stop_loss (double precision)
- take_profit (double precision)
- risk_reward (double precision)
- confidence (double precision, 0-1)
- rationale (text)
- source_ob_id (uuid, foreign key to smc_order_blocks)
- created_at (timestamptz, default now())
```

---

## Flutter Integration

### Usage Example

```dart
import 'package:your_app/services/smc_service.dart';

// Initialize SMC data for a ticker
final success = await SMCService.initializeSMC(
  ticker: 'AAPL',
  timeframe: '1h',
);

// Fetch SMC analysis
final analysis = await SMCService.getSMCLevels(
  ticker: 'AAPL',
  timeframe: '1h',
);

if (analysis != null) {
  print('Active bullish OBs: ${analysis.activeBullishOBs.length}');
  print('AI Summary: ${analysis.aiSummary}');
}

// Get trade setups
final setups = await SMCService.getSMCTrades(
  ticker: 'AAPL',
  timeframe: '1h',
  userTier: 'pro',
);

for (var setup in setups) {
  print('${setup.side.toUpperCase()}: Entry ${setup.entry}, '
        'SL ${setup.stopLoss}, TP ${setup.takeProfit}, '
        'R:R ${setup.riskRewardFormatted}, '
        'Confidence ${setup.confidencePercent}');
}

// Refresh SMC data (force recalculation)
await SMCService.refreshSMC(
  ticker: 'AAPL',
  timeframe: '1h',
);
```

---

## Deployment

### 1. Deploy Migration
```bash
cd supabase
npx supabase db push
```

### 2. Deploy Edge Functions
```bash
npx supabase functions deploy smc_calculate_levels
npx supabase functions deploy smc_get_levels
npx supabase functions deploy smc_get_trade_setups
```

### 3. Set Environment Variables
```bash
npx supabase secrets set OPENAI_API_KEY=sk-...
```

---

## Performance & Caching

- **Data Retention:** 30 days (auto-cleanup)
- **Free Tier Cache:** 10 minutes for trade setups
- **Bar Limits:** 
  - 5m: ~2,880 bars (5 days)
  - 1h: ~720 bars (1 month)
  - 1d: ~180 bars (6 months)
- **Rate Limits:** Inherited from `get_chart` function

---

## Testing

### Test Calculate Levels
```bash
curl -X POST http://localhost:54321/functions/v1/smc_calculate_levels \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"AAPL","timeframe":"1h"}'
```

### Test Get Levels
```bash
curl -X POST http://localhost:54321/functions/v1/smc_get_levels \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"AAPL","timeframe":"1h"}'
```

### Test Trade Setups
```bash
curl -X POST http://localhost:54321/functions/v1/smc_get_trade_setups \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"AAPL","timeframe":"1h","user_tier":"pro"}'
```

---

## Error Handling

| Error Code | Message | Resolution |
|------------|---------|------------|
| `missing_ticker` | Ticker is required | Provide valid ticker symbol |
| `invalid_timeframe` | Must be 5m, 15m, 1h, 4h, or 1d | Use supported timeframe |
| `no_data` | Unable to fetch chart data | Check Yahoo Finance availability |
| `insufficient_data` | Not enough historical data | Try different timeframe |
| `no_smc_data` | No SMC data found | Run `smc_calculate_levels` first |
| `db_error` | Database operation failed | Check Supabase logs |

---

## Files Created

### Backend (Supabase)
- `migrations/20251128_smc_tables.sql` - Database schema
- `functions/shared/smc_detector.ts` - SMC detection logic
- `functions/smc_calculate_levels/index.ts` - Calculation engine
- `functions/smc_get_levels/index.ts` - Data fetcher
- `functions/smc_get_trade_setups/index.ts` - AI trade generator

### Frontend (Flutter)
- `lib/models/smc_model.dart` - Data models
- `lib/services/smc_service.dart` - Service integration
- `lib/screens/stock_detail/stock_detail_screen.dart` - Stock detail screen
- Updated `lib/app_root.dart` - Added routing

---

## Next Steps

1. Create SMC UI components (chart overlays, OB list, trade cards)
2. Implement state management with Riverpod
3. Add Pro/Free tier logic
4. Build interactive chart with Syncfusion
5. Test with real tickers (AAPL, TSLA, SPY, BTC-USD)
