# Signal Job Inventory (Jan 20, 2026)

This document captures every scheduled job / edge function currently wired into the signal + trading pipeline, along with their observed state and retirement plan per the new simplification initiative.

## Legacy jobs slated for retirement

| Job / Function | Schedule (observed) | Source | Current state (DB/log evidence) | Retirement action |
| --- | --- | --- | --- | --- |
| `hourly_swing_signals` | Hourly at HH:30 (UTC-aligned) | Supabase Edge Function (name inferred from `signal_run_log.cron_jobname`) | Last run `2026-01-06T21:30:07Z`, `status="error"`, per-symbol logs show `insufficient_bars` | Disable Supabase schedule, remove function once new pipeline live |
| `hourly_daytrader_signals` | Hourly at HH:30 | Supabase Edge Function (`signal_run_log`) | Last run `2026-01-06T21:30:06Z`, `status="warn"` (0 signals generated) | Disable and delete |
| `evaluate_signals_daily` | Daily (exact cron unknown) | Edge Function invoked via `/functions/v1/evaluate_signals_daily` | Still runs (latest log `2026-01-20T14:40Z`) but only prints “No signals to evaluate” | Remove trigger after new architecture online |
| Visibility evaluator (engine_type=`VISIBILITY`) | Unknown | n/a | No entries in `signal_run_log`; assumed unused | Confirm absence, delete any leftover code / schedules |

## Other edge functions (non-signal critical)

- `system_heartbeat`, `ai_market_summary`, etc. remain untouched—they are informational, not part of the trading pipeline.

## Notes

- Legacy signal jobs rely on historical OHLC tables that are no longer refreshed, causing `insufficient_bars` errors. New jobs (`bars_ingest_1m`, `signals_generate_1h`, `execute_engine`) will replace them entirely.
- Supabase schedules for the legacy jobs must be disabled in the dashboard once this repo ships the replacement code. Until then, we keep the documentation as reference.

## New minimal jobs to keep

| Job | Endpoint | Schedule suggestion | Description |
| --- | --- | --- | --- |
| `bars_ingest_1m` | `POST /api/jobs/bars-ingest` | Every minute, 09:00–16:10 ET | Pull Alpaca minute bars into `bars_1m`, log stale/missing symbols. |
| `signals_generate_1h` | `POST /api/jobs/signals-generate` | Hourly at HH:05 (10:05–15:05 ET) | Build completed 1H/4H candles, enforce rule locks, upsert ai_signals. |
| `execute_engine` | `POST /api/jobs/execute-engine` | Every 3 minutes, 10:00–15:55 ET | Trade runner consuming active signals, writing `live_trades` + updating ai_signals. |
