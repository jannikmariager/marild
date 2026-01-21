## TradeSignals pipeline (January 21, 2026)

### 1. Data ingestion (`/api/jobs/bars-ingest`)
- Trigger every minute between 09:00–16:10 ET with `JOB_CRON_SECRET`.
- Loads enabled tickers from `ticker_whitelist`, fetches the freshest Alpaca 1m bar per symbol, and upserts into `bars_1m` (primary key `(symbol, ts)`).
- Skips symbols whose latest bar is older than `marketClock.maxDataStalenessMinutes()` and records `stale`/`missing` counts in `job_run_log`.

### 2. Signal generation (`/api/jobs/signals-generate`)
- Runs hourly at HH:05 once the 1H candle closes. Builds 1H (`window1h`) and 4H (`window4h`) composites via `aggregateBars`.
- Skips when there are no fresh bars or insufficient body/trend alignment. Otherwise computes direction, entry, risk, and gates the signal using `marketClock`.
- Invalidates prior rows for the same `(symbol, timeframe)` that are still `active`/`watchlist` before upserting the new record (unique key `(symbol,timeframe,signal_bar_ts)` enforced in the latest migration).
- Annotates each row with `trade_gate_allowed`, `trade_gate_reason`, `data_freshness_minutes`, and enrichment fallbacks so the UI can distinguish watchlist, active, and enriched states.

### 3. Execution (`/api/jobs/execute-engine`)
- Runs inside the 10:00–15:55 ET trade window. Selects `ai_signals` where `status='active'`, `trade_gate_allowed=true`, and `performance_traded=false`.
- Calculates a deterministic position size (`DEFAULT_NOTIONAL / entry_price`), inserts into `live_trades`, and flips the originating signal to `status='filled'`, `performance_traded=true`, `performance_trade_status='OPEN'`.
- Failures (missing entry, insert errors) are logged in `job_run_log.details`.

### 4. Pruning stale/duplicate rows (`/api/jobs/signals-prune`)
- New maintenance job that deletes historical signals so the TradeSignals page only sees fresh data.
- Defaults: delete rows older than 72h with statuses in `['filled','tp_hit','sl_hit','timed_out','expired','invalidated']`. Pass `includeActive=true` or `statuses=watchlist,active` if you intentionally want to clear live slots.
- Sample command (replace the secret before running):
  ```
  curl -X POST "https://<your-app-domain>/api/jobs/signals-prune?hours=1" \
    -H "Authorization: Bearer {{JOB_CRON_SECRET}}"
  ```
- Supports `dryRun=true` to preview counts, or `before=2026-01-20T00:00:00Z` for an absolute cutoff.

### 5. Frontend safeguards
- `components/tradesignals/SignalsTable` now fetches up to 500 recent rows, deduplicates by `(symbol,timeframe)` (keeping the newest by `updated_at`), and paginates client-side to eliminate duplicate renderings.
- The table surfaces badges for `AI TRADE PLAN`, `AI TRADED`, and the new `Plan` column that shows queued/blocked/traded status using `performance_traded`, `performance_trade_status`, and `trade_gate_allowed`.
- Users can still open the archive drawer for anything older than 72h, but the main list stays focused on unique, current setups.
