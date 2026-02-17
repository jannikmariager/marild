-- 20260217120000_weekly_reports_metrics_columns.sql

alter table public.weekly_execution_reports
  add column if not exists equity_at_week_start numeric not null default 0,
  add column if not exists equity_at_week_end numeric not null default 0,
  add column if not exists winners int not null default 0,
  add column if not exists losers int not null default 0,
  add column if not exists avg_hold_hours numeric not null default 0,
  add column if not exists largest_win_usd numeric not null default 0,
  add column if not exists largest_loss_usd numeric not null default 0;
