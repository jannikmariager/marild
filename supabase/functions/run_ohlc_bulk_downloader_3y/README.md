# TradeLens 3-Year Bulk OHLC Downloader

Downloads 3 years of historical OHLC data for 150 tickers across 6 timeframes using Polygon.io API.

## Features

- **150 Tickers**: Curated universe from S&P 500, NDX100, high-volatility stocks, leveraged ETFs, crypto proxies
- **6 Timeframes**: 5m, 15m, 1h, 4h, 1d, 1w
- **Memory-Safe Streaming**: Paginated downloads with async generators
- **Incremental Updates**: Daily append mode to add only new bars
- **Storage**: JSONL format in `ohlc-cache` bucket
- **Rate Limited**: 100ms delay between API requests

## Architecture

```
run_ohlc_bulk_downloader_3y/index.ts  ← Main orchestrator
    ↓
massive_client_3y.ts                  ← Polygon API client (streaming)
    ↓
storage_stream_3y.ts                  ← Storage upload/append
    ↓
ohlc-cache bucket                     ← Final storage
```

## Usage

### Full Download (Initial)

Downloads complete 3-year history for all tickers/timeframes:

```bash
curl -X POST \
  "https://your-project.supabase.co/functions/v1/run_ohlc_bulk_downloader_3y?mode=full" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Append Mode (Daily Updates)

Only downloads bars after last existing timestamp:

```bash
curl -X POST \
  "https://your-project.supabase.co/functions/v1/run_ohlc_bulk_downloader_3y?mode=append" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

### Subset Testing

Test with specific tickers/timeframes:

```bash
curl -X POST \
  "https://your-project.supabase.co/functions/v1/run_ohlc_bulk_downloader_3y?mode=full&tickers=AAPL,TSLA&timeframes=1h,1d" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Parameters

- `mode` (required): `full` or `append`
- `tickers` (optional): Comma-separated tickers or "all" (default: all 150)
- `timeframes` (optional): Comma-separated intervals or "all" (default: all 6)

## Storage Structure

```
ohlc-cache/
├── AAPL/
│   ├── 5m.jsonl
│   ├── 15m.jsonl
│   ├── 1h.jsonl
│   ├── 4h.jsonl
│   ├── 1d.jsonl
│   └── 1w.jsonl
├── TSLA/
│   └── ...
└── ...
```

## JSONL Format

Each line is a bar:

```jsonl
{"t":1638316800000,"o":151.5,"h":152.3,"l":150.8,"c":151.9,"v":1234567}
{"t":1638320400000,"o":151.9,"h":153.1,"l":151.2,"c":152.8,"v":2345678}
```

## Environment Variables

Required:
- `POLYGON_API_KEY` - Your Polygon.io API key
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for storage access

## Response Format

```json
{
  "mode": "full",
  "duration_seconds": 3456.78,
  "tickers": 150,
  "timeframes": 6,
  "total_combinations": 900,
  "success": 895,
  "failed": 5,
  "total_bars": 12500000,
  "results": [
    {
      "symbol": "AAPL",
      "interval": "5m",
      "success": true,
      "bars": 157680
    },
    ...
  ]
}
```

## Scheduling

For daily updates, schedule append mode:

```bash
# Example cron: Daily at 8 PM EST (after market close)
0 20 * * * curl -X POST "https://your-project.supabase.co/functions/v1/run_ohlc_bulk_downloader_3y?mode=append" -H "Authorization: Bearer YOUR_ANON_KEY"
```

## Ticker Universe

### Mega-caps (20)
AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA, BRK.B, UNH, JNJ, XOM, V, WMT, JPM, PG, MA, CVX, HD, MRK, ABBV

### Large-caps (30)
AVGO, LLY, COST, PEP, ADBE, NFLX, TMO, CSCO, ACN, MCD, ABT, CRM, DHR, ORCL, WFC, BAC, DIS, NKE, AMD, TXN, BMY, QCOM, PM, NEE, INTC, RTX, IBM, HON, UNP, GE

### Tech/Growth (20)
PLTR, SNOW, DDOG, NET, CRWD, ZS, MDB, PANW, ROKU, SQ, SHOP, SNAP, UBER, LYFT, ABNB, COIN, RBLX, U, PATH, DOCN

### High-Volatility (20)
GME, AMC, BBBY, BYND, LCID, RIVN, NKLA, HOOD, SOFI, CLOV, TLRY, SNDL, WISH, SPCE, PLUG, FCEL, BLNK, NIO, XPEV

### Leveraged ETFs (30)
TQQQ, SQQQ, UPRO, SPXU, TNA, TZA, UDOW, SDOW, TECL, TECS, FAS, FAZ, ERX, ERY, LABU, LABD, NAIL, DUST, NUGT, JNUG, UCO, SCO, UNG, BOIL, KOLD, USO, DGAZ, UGAZ, XLE, XLF

### Crypto Proxies (10)
MSTR, MARA, RIOT, CLSK, HUT, BITF, BITO, GBTC, ETHE, SI

### Indices/Sectors (10)
SPY, QQQ, IWM, DIA, VTI, VOO, XLK, XLV, XLE, XLF

### International (10)
EEM, FXI, EWJ, EWZ, EWW, EWY, INDA, EWT, MCHI, ASHR

## Estimated Data Volume

- **Per ticker-timeframe**: 10K-200K bars
- **Total bars**: ~12-15 million
- **Storage size**: ~2-3 GB (JSONL compressed)

## Rate Limiting

- Polygon.io: 5 requests/second (basic plan)
- Implementation: 100ms delay = 10 requests/second (within limit)
- Estimated duration: ~90-120 minutes for full download

## Error Handling

- Failed downloads logged but don't stop execution
- Each ticker-interval independent
- Retry manually for failed combinations
- Results include error messages for failures

## Testing

Local test with subset:

```bash
cd /Users/jannik/Projects/tradelens_ai
./test_bulk_downloader.sh
```

Or with Supabase CLI:

```bash
supabase functions serve run_ohlc_bulk_downloader_3y
```

Then:

```bash
curl "http://localhost:54321/functions/v1/run_ohlc_bulk_downloader_3y?mode=full&tickers=AAPL&timeframes=1d"
```

## Maintenance

1. **Initial Setup**: Run `mode=full` once to populate historical data
2. **Daily Updates**: Schedule `mode=append` via cron or Supabase scheduled functions
3. **Missing Data**: Re-run specific tickers with `mode=full` to overwrite
4. **Monitor**: Check function logs for errors and success rates
