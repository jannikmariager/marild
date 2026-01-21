-- bars_1m stores raw 1-minute bars ingested from Alpaca (or other providers).
create table if not exists public.bars_1m (
    symbol text not null,
    ts timestamptz not null,
    open numeric(18,6) not null,
    high numeric(18,6) not null,
    low numeric(18,6) not null,
    close numeric(18,6) not null,
    volume numeric(20,4),
    source text not null default 'alpaca',
    created_at timestamptz not null default timezone('utc', now()),
    constraint bars_1m_pkey primary key (symbol, ts)
);

create index if not exists bars_1m_symbol_ts_desc_idx on public.bars_1m (symbol, ts desc);

-- Job run log for observability.
create table if not exists public.job_run_log (
    id uuid primary key default gen_random_uuid(),
    job_name text not null,
    run_id text not null,
    started_at timestamptz not null default timezone('utc', now()),
    finished_at timestamptz,
    ok boolean,
    counts jsonb default '{}'::jsonb,
    error text,
    details jsonb default '{}'::jsonb
);

create index if not exists job_run_log_name_started_idx on public.job_run_log (job_name, started_at desc);

-- ai_signals extensions (idempotent).
alter table public.ai_signals
    add column if not exists signal_bar_ts timestamptz;

update public.ai_signals
set signal_bar_ts = coalesce(signal_bar_ts, created_at)
where signal_bar_ts is null;

alter table public.ai_signals
    alter column signal_bar_ts set not null;

alter table public.ai_signals
    add column if not exists ai_enriched boolean not null default true;

alter table public.ai_signals
    add column if not exists data_freshness_minutes integer not null default 0;

alter table public.ai_signals
    add column if not exists setup_type text;

alter table public.ai_signals
    add constraint ai_signals_symbol_tf_bar_unique unique (symbol, timeframe, signal_bar_ts);
