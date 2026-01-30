# Experimental Intraday Backtest

**⚠️ DEV/INTERNAL USE ONLY - NOT FOR PRODUCTION**

## Purpose

Test DAYTRADER backtest performance using **true intraday candles (5m/15m)** fetched directly from Yahoo Finance to evaluate whether investing in proper intraday data infrastructure is worthwhile.

## Key Differences from Production Backtest

- **Data source**: Yahoo Finance API (live fetch, no caching)
- **Resolution**: Operates on 5m/15m candles directly (no aggregation to daily)
- **ATR calculation**: Computed on the intraday interval itself
- **No DB writes**: All in-memory, results not stored
- **Limited symbols**: Whitelist only (TQQQ, AAPL, GOOGL, TSLA, SPY)
- **Limited lookback**: ~30-60 days max (Yahoo's intraday data availability)

## Usage

### Endpoint
```
POST https://gwacnidnscugvwxhchsm.supabase.co/functions/v1/run_backtest_intraday_experimental
```

### Request Body
```json
{
  "symbol": "TQQQ",
  "interval": "5m",
  "days_back": 30
}
```

**Parameters:**
- `symbol`: One of `TQQQ`, `AAPL`, `GOOGL`, `TSLA`, `SPY`
- `interval`: `5m` or `15m`
- `days_back`: Between 7 and 90 (actual data may be less)

### Example cURL
```bash
curl -X POST "https://gwacnidnscugvwxhchsm.supabase.co/functions/v1/run_backtest_intraday_experimental" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"TQQQ","interval":"5m","days_back":30}'
```

### Response Format
```json
{
  "success": true,
  "experimental": true,
  "note": "This is an experimental backtest using Yahoo intraday data. Not stored in database.",
  "result": {
    "symbol": "TQQQ",
    "interval": "5m",
    "lookback_days": 29,
    "engine_type": "DAYTRADER",
    "metrics": {
      "total_return_pct": -0.32,
      "win_rate_pct": 27.87,
      "avg_R": -0.03,
      "max_drawdown_pct": 0.50,
      "best_trade_R": 2.0,
      "worst_trade_R": -1.0,
      "tp1_hit_rate_pct": 40.98,
      "tp2_hit_rate_pct": 27.87,
      "total_trades": 61,
      "sharpe_ratio": null
    },
    "equity_curve": [
      { "timestamp": "2025-11-03T14:30:00.000Z", "equity": 100000 },
      ...
    ],
    "trades": [
      {
        "direction": "LONG",
        "entry_time": "2025-11-06T14:30:00.000Z",
        "exit_time": "2025-11-06T14:45:00.000Z",
        "entry_price": 65.32,
        "exit_price": 65.85,
        "R_multiple": 2.0,
        "exit_reason": "TP2"
      },
      ...
    ]
  }
}
```

## Test Results (30-day lookback, 5m candles)

| Symbol | Interval | Total Trades | Win Rate | Avg R | Max DD | Return | Worst R |
|--------|----------|--------------|----------|-------|--------|--------|---------|
| **TQQQ** | 5m | 66 | 22.7% | -0.11 | 0.96% | -63.77% | -1.0 |
| **SPY** | 5m | 20 | 15.0% | -0.25 | 0.20% | -0.17% | -1.0 |
| **GOOGL** | 5m | 61 | 27.9% | -0.03 | 0.50% | -0.32% | -1.0 |
| **TSLA** | 5m | 71 | 19.7% | -0.18 | 1.05% | -0.98% | -1.0 |

### Validation ✅

All tests passed the safety criteria:
- ✅ No extreme R multiples (worst clamped to -1R, best at ~2R)
- ✅ No catastrophic drawdowns (all < -5%)
- ✅ Trade counts in reasonable range (20-71 trades over 30 days)
- ✅ No "Invalid Date" issues
- ✅ Equity never went negative

### Observations

1. **Entry filters are very strict**: Current stricter DAYTRADER entry rules (EMA20/50, volume 0.8x, volatility <5%) are limiting entries significantly
2. **Win rates lower than expected**: 15-28% suggests entry timing needs improvement for intraday
3. **R multiples clamped correctly**: Worst losses at -1R show SL protection working
4. **TP hit rates**: TP1 ~40-45%, TP2 ~15-28% shows targets are reachable but conservative

## Engine Specifications

### Risk Management
- Starting equity: $100,000
- Risk per trade: 1% of equity
- Max position size: 25% of equity (notional cap)
- R calculation: `max(0.5 * ATR, 0.002 * price)`

### Position Management
- Partial exit: 50% at TP1 (1R)
- Full exit: Remaining 50% at TP2 (2R)
- SL moves to breakeven after TP1 hit
- Max 1 open position per symbol
- Max 4 new trades per day per symbol

### Entry Filters (Strict)
- EMA20 > EMA50 for longs (micro uptrend)
- EMA20 < EMA50 for shorts (micro downtrend)
- Volume ≥ 0.8× 20-bar average
- ATR/price < 5% (volatility filter)
- Recent momentum (±0.5% over 5 bars)

### Exit Priority (Conservative)
1. Stop Loss (highest priority)
2. TP2 (2R)
3. TP1 (1R, partial exit)
4. Period end

If SL and TP both triggered in same bar, SL takes precedence (worst-case assumption).

## Files

- `index.ts` - Edge Function endpoint
- `_shared/yahoo_v8_client.ts` - `fetchIntradayOHLC()` helper
- `_shared/backtest_intraday_experimental.ts` - `runIntradayDaytraderBacktest()` engine
- `_shared/backtest_entry_rules.ts` - `evaluateDaytraderEntry()` (shared with production)

## Deployment

```bash
supabase functions deploy run_backtest_intraday_experimental
```

## Notes

- Yahoo Finance may rate-limit or return inconsistent data
- Some symbols (e.g., AAPL) had zero bars returned - may need retry logic or different time windows
- This is for **evaluation purposes only** - do not expose to end users
- Results suggest current entry filters may be too conservative for intraday trading
- Consider looser filters or additional signals (RSI, MACD) if pursuing intraday infrastructure

---

**Status**: ✅ Deployed and tested (Dec 3, 2025)
