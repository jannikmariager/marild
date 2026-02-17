-- 20260217104000_weekly_execution_reports_and_outbound_posts.sql

-- Weekly execution reports (public)
create table if not exists public.weekly_execution_reports (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  week_start date not null,
  week_end date not null,
  week_label text not null,
  published_at timestamptz not null default timezone('utc', now()),

  metrics_json jsonb not null,
  report_json jsonb not null,
  report_markdown text not null,
  excerpt text not null,

  net_pnl_usd numeric not null,
  net_return_pct numeric not null,
  closed_trades int not null,
  win_rate_pct numeric not null,
  profit_factor numeric not null,
  max_drawdown_pct numeric not null,

  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists weekly_execution_reports_week_end_idx
  on public.weekly_execution_reports (week_end desc);

create index if not exists weekly_execution_reports_published_at_idx
  on public.weekly_execution_reports (published_at desc);

alter table public.weekly_execution_reports enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'weekly_execution_reports'
      and policyname = 'public_select_weekly_execution_reports'
  ) then
    create policy public_select_weekly_execution_reports
      on public.weekly_execution_reports
      for select
      using (true);
  end if;
end;
$$;

-- Outbound posts queue (private)
create table if not exists public.outbound_posts (
  id uuid primary key default gen_random_uuid(),
  report_id uuid references public.weekly_execution_reports(id) on delete cascade,
  channel text not null,
  status text not null default 'pending',
  payload jsonb not null,
  attempt_count int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists outbound_posts_status_idx
  on public.outbound_posts (status, created_at);

-- Prevent duplicate trade enqueues for the Discord closed-trades feed.
-- Uses payload.trade_id (string) + channel.
create unique index if not exists outbound_posts_unique_trade_id_channel_idx
  on public.outbound_posts (channel, (payload->>'trade_id'))
  where channel = 'discord_trades';

alter table public.outbound_posts enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'outbound_posts'
      and policyname = 'service_role_all_outbound_posts'
  ) then
    create policy service_role_all_outbound_posts
      on public.outbound_posts
      for all
      using (auth.role() = 'service_role')
      with check (auth.role() = 'service_role');
  end if;
end;
$$;
