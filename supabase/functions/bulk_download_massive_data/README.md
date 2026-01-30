# Massive OHLC Bulk Downloader

Edge Function to download historical OHLC data from Massive/Polygon.io and store in Supabase Storage.

## Setup

### 1. Create Storage Bucket

Go to Supabase Dashboard → Storage → Create bucket:
- **Name**: `ohlc-cache`
- **Public**: ✅ Yes
- **File size limit**: 500 MB
- **Allowed MIME types**: 
  - `application/x-ndjson`
  - `application/json`
  - `text/plain`

Or execute this SQL in the SQL Editor:

```sql
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ohlc-cache',
  'ohlc-cache',
  true,
  524288000,
  ARRAY['application/x-ndjson', 'application/json', 'text/plain']
) ON CONFLICT (id) DO NOTHING;
```

### 2. Set Environment Variables

Make sure these secrets are set (already configured):
- `MASSIVE_API_KEY` or `POLYGON_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

### 3. Deploy Function

```bash
npx supabase functions deploy bulk_download_massive_data --no-verify-jwt
```

## Usage

### Test with 3 tickers (1 month of 5m data):

```bash
./tools/test_bulk_download.sh
```

### Full daytrading data download (48 tickers, 6 months, 5m interval):

```bash
curl -X POST \
  'https://gwacnidnscugvwxhchsm.supabase.co/functions/v1/bulk_download_massive_data' \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "tickers": ["AAPL", "TSLA", "MSFT", "NVDA", ...],
    "interval": "5/minute",
    "from": "2024-06-01",
    "to": "2024-12-03"
  }'
```

### Parameters

- **tickers**: Array of ticker symbols (e.g. `["AAPL", "TSLA"]`)
- **interval**: Polygon.io format `{multiplier}/{timespan}`
  - `"1/minute"` = 1m bars
  - `"5/minute"` = 5m bars
  - `"15/minute"` = 15m bars
  - `"1/hour"` = 1h bars
  - `"1/day"` = 1D bars
- **from**: Start date `YYYY-MM-DD`
- **to**: End date `YYYY-MM-DD`

## Response

```json
{
  "status": "complete",
  "count": 3,
  "successful": 3,
  "total_bars": 89247,
  "duration_seconds": 15.4,
  "results": [
    {
      "symbol": "AAPL",
      "interval": "5/minute",
      "bars": 29749,
      "file_url": "https://.../ohlc-cache/AAPL/5m.jsonl",
      "status": "success"
    },
    ...
  ]
}
```

## Features

- ✅ Polygon.io API integration with pagination
- ✅ Streams data to `/tmp` to minimize memory usage
- ✅ JSONL format for efficient storage
- ✅ Automatic retry and error handling
- ✅ Rate limiting (100ms between requests)
- ✅ Uploads to Supabase Storage
- ✅ Returns public URLs for downloaded files

## File Structure

Downloaded files are stored as:
```
ohlc-cache/
  AAPL/
    5m.jsonl
    1h.jsonl
  TSLA/
    5m.jsonl
```

Each line in the JSONL file is a single bar:
```jsonl
{"t":1701446400000,"o":195.09,"h":195.41,"l":194.97,"c":195.18,"v":123456}
{"t":1701446700000,"o":195.18,"h":195.32,"l":195.04,"c":195.22,"v":98765}
```

## Memory Efficiency

- Streams data page-by-page to disk
- Temp files automatically cleaned up
- No full dataset stored in memory
- Can handle 100k+ bars per ticker without issues

## Recommended Batch Sizes

To avoid function timeouts:
- **5m data**: 10-15 tickers per request (6 months)
- **1m data**: 5-8 tickers per request (6 months)
- **1h/1D data**: 20-30 tickers per request (2 years)
