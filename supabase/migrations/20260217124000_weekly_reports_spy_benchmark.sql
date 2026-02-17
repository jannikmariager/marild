-- 20260217124000_weekly_reports_spy_benchmark.sql

alter table public.weekly_execution_reports
  add column if not exists spy_return_pct numeric null,
  add column if not exists alpha_vs_spy_pct numeric null;
