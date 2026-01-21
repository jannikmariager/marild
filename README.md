## Marild Signal Platform – Simplified Architecture (January 2026)

The trading stack has been consolidated around one ticker universe, one bar store, one signal table, and three deterministic jobs. This section documents the current source of truth and the operational rules that guardrail it.

### Data model

- `ticker_whitelist`: single canonical universe (editable via Admin). Only `is_enabled = true` symbols participate in jobs.
- `bars_1m`: raw Alpaca 1‑minute OHLCV bars keyed by `(symbol, ts)`.
- `ai_signals`: single truth table for watchlist/active/filled signals. Key fields:
  - `signal_bar_ts` (unique per symbol + timeframe)
  - `status` enum-like (`watchlist`, `active`, `filled`, `invalidated`, `expired`)
  - `trade_gate_allowed`, `trade_gate_reason`, `blocked_until_et`
  - `ai_enriched`, `data_freshness_minutes`, `setup_type`
- `job_run_log`: observability for every scheduled job.

### Direction vs. volatility

- `signal_type` continues to answer “Do we have a directional edge on the 1H timeframe given the 4H context?” (BUY / SELL / NEUTRAL).
- `volatility_state` now answers “Is price movement elevated enough to matter?” using ATR(14) percentiles across roughly the last 60 trading days. States: LOW, NORMAL, HIGH, EXTREME.
- These concepts are independent. It is valid to see combinations such as `NEUTRAL + HIGH` or `SELL + LOW`. Volatility never forces a trade, upgrades NEUTRAL into BUY/SELL, or bypasses trade gating.
- Tooltips and FAQ copy reiterate: “Volatility shows how much price is moving. Signal shows directional edge.”

### Mandatory rule locks

1. **Single active signal** – every hourly run invalidates the previous active signal for the same `(symbol, timeframe)` before inserting the new one (unique constraint enforces this).
2. **Completed candles only** – 1H strategy and 4H context are derived from the last fully closed ET candles. Partial candles skip with a logged reason.
3. **Trade gate defense** – `signals_generate_1h` annotates gating fields; `execute_engine` refuses to trade unless `status='active'` and `trade_gate_allowed=true`. Default gate blocks trading before 10:00 ET.
4. **AI fallback** – enrichment failures do not block signals; we set `ai_enriched=false` and `reasoning = "<deterministic text> AI enrichment unavailable."`
5. **Data freshness** – if the latest 1m bar is older than 2 minutes a symbol is skipped and logged as `stale_data_skip`.

### Jobs (triggered via POST with `JOB_CRON_SECRET`)

| Endpoint | Window (ET) | Responsibility |
| --- | --- | --- |
| `POST /api/jobs/bars-ingest` | 09:00–16:10 | Pull latest 1m bars from Alpaca for the whitelist, upsert into `bars_1m`, log stale/missing symbols. |
| `POST /api/jobs/signals-generate` | HH:05 (10:05–15:05) | Aggregate 1m→1h (+4h context), enforce rule locks, upsert signals, invalidate old actives, capture stale skips / no-setup symbols. |
| `POST /api/jobs/execute-engine` | 10:00–15:55 | Consume `ai_signals` where `trade_gate_allowed=true` & `performance_traded=false`, create `live_trades` entries, mark signals `filled`. |

The legacy jobs (`hourly_swing_signals`, `hourly_daytrader_signals`, `evaluate_signals_daily`, visibility evaluator) are documented in `docs/signal-job-inventory.md` and should remain disabled.

### Configuration

Set the following environment variables:

- `JOB_CRON_SECRET` – shared secret for all job endpoints.
- `ALPACA_API_KEY_ID`, `ALPACA_API_SECRET_KEY`, `ALPACA_DATA_URL` – Alpaca Market Data credentials.
- Optional overrides: `INGEST_START_ET`, `INGEST_END_ET`, `TRADE_GATE_START_ET`, `TRADE_GATE_END_ET`, `DATA_FRESHNESS_MAX_MINUTES`, `MARKET_HOLIDAYS_JSON`, `EXECUTION_DEFAULT_NOTIONAL`.

### Validation checklist

1. Run migrations under `supabase/migrations`. Confirm tables exist and `ai_signals` uniqueness constraint is active.
2. Trigger `/api/jobs/bars-ingest` during the ingest window. Verify:
   - `bars_1m` receives rows.
   - `job_run_log` entry counts match processed symbols / stale / missing.
3. Trigger `/api/jobs/signals-generate` (after bars exist). Confirm:
   - `ai_signals` rows receive `signal_bar_ts`, `data_freshness_minutes`, gating fields.
   - Only one `status='active'` row per symbol/timeframe.
   - `job_run_log.details` lists stale/no-setup symbols.
4. Trigger `/api/jobs/execute-engine` (during trading window). Confirm:
   - `live_trades` receives inserts with `signal_id`.
   - Corresponding `ai_signals` rows flip to `status='filled'`, `performance_traded=true`.
5. Frontend / Flutter should now load everything from `ai_signals` (no alternate sources).

### Running locally

```bash
npm install
npm run dev
```

- Hit job endpoints manually with the shared secret using `curl` or the Supabase scheduler.
- The admin dashboards (signals + debug pages) surface `job_run_log` metrics for quick health checks.

### Deploying jobs

Use your scheduler of choice (Supabase cron, Vercel cron, or any orchestrator) to POST the three endpoints above with `Authorization: Bearer $JOB_CRON_SECRET` on the cadence described. Delete the legacy schedules once the new pipeline is verified.

### Portfolio performance & P&L attribution

1. Apply migration `supabase/migrations/20260121133000_live_trades_realized_date.sql`. This creates `realized_pnl_date`, backfills it from `exit_timestamp`, and adds guardrails so realized P&L can only be written when a trade is actually closed.
2. If the migration cannot be replayed (e.g., production DB already has the column), re-run the backfill manually:

   ```sql
   update public.live_trades
   set realized_pnl_date = date(exit_timestamp)
   where exit_timestamp is not null
     and realized_pnl_dollars is not null
     and realized_pnl_date is null;
   ```

3. `live_portfolio_state` snapshots remain the source of mark-to-market equity. The journal (`/api/performance/journal`), summary (`/api/performance/summary`), and live portfolio (`/api/live-portfolio`) APIs now build a daily series by combining:
   - Realized trades grouped by `realized_pnl_date`.
   - Equity snapshots for unrealized drift between closes.
   - Current open-position unrealized P&L applied to the latest day only.
4. Never set `realized_pnl_dollars` or `realized_pnl_date` directly in application code. Book realized values by writing `exit_timestamp`, `exit_price`, and `realized_pnl_dollars`; the trigger keeps the date in sync.
5. When auditing discrepancies, first verify that `live_portfolio_state` contains the latest `equity_dollars` rows. Stale snapshots will manifest as flat unrealized curves even if trades are correct.
