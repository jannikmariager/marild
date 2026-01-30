-- Market context policy & snapshot tables

create table if not exists public.market_context_policies (
    id uuid primary key default gen_random_uuid(),
    policy_version text not null,
    name text not null,
    is_active boolean not null default false,
    config jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now()),
    constraint market_context_policies_version_name_uniq unique (policy_version, name)
);

create index if not exists market_context_policies_active_idx
    on public.market_context_policies (policy_version, is_active);

create table if not exists public.market_context_snapshots (
    id uuid primary key default gen_random_uuid(),
    as_of timestamptz not null,
    vix_level numeric(10,4),
    vix_percentile numeric(10,4),
    es_gap_pct numeric(10,4),
    nq_gap_pct numeric(10,4),
    realized_vol numeric(10,4),
    breadth_riskoff_score numeric(10,4),
    raw jsonb default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists market_context_snapshots_as_of_idx
    on public.market_context_snapshots (as_of desc);

create table if not exists public.market_context_policy_decisions (
    id uuid primary key default gen_random_uuid(),
    policy_id uuid references public.market_context_policies (id) on delete set null,
    snapshot_id uuid references public.market_context_snapshots (id) on delete set null,
    policy_version text not null,
    as_of timestamptz not null,
    regime text,
    trade_gate text check (trade_gate in ('OPEN','CLOSE')),
    risk_scale numeric(10,4) not null default 1.0,
    max_positions_override integer,
    notes text[] default '{}',
    decision jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists market_context_policy_decisions_policy_as_of_idx
    on public.market_context_policy_decisions (policy_version, as_of desc);

-- RLS: service_role full access, authenticated read-only
alter table public.market_context_policies enable row level security;
alter table public.market_context_snapshots enable row level security;
alter table public.market_context_policy_decisions enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'market_context_policies'
      and policyname = 'service_role_all_market_context_policies'
  ) then
    create policy service_role_all_market_context_policies
      on public.market_context_policies
      for all
      using (auth.role() = 'service_role');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'market_context_policies'
      and policyname = 'authenticated_read_market_context_policies'
  ) then
    create policy authenticated_read_market_context_policies
      on public.market_context_policies
      for select
      using (auth.role() = 'authenticated');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'market_context_snapshots'
      and policyname = 'service_role_all_market_context_snapshots'
  ) then
    create policy service_role_all_market_context_snapshots
      on public.market_context_snapshots
      for all
      using (auth.role() = 'service_role');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'market_context_snapshots'
      and policyname = 'authenticated_read_market_context_snapshots'
  ) then
    create policy authenticated_read_market_context_snapshots
      on public.market_context_snapshots
      for select
      using (auth.role() = 'authenticated');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'market_context_policy_decisions'
      and policyname = 'service_role_all_market_context_policy_decisions'
  ) then
    create policy service_role_all_market_context_policy_decisions
      on public.market_context_policy_decisions
      for all
      using (auth.role() = 'service_role');
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'market_context_policy_decisions'
      and policyname = 'authenticated_read_market_context_policy_decisions'
  ) then
    create policy authenticated_read_market_context_policy_decisions
      on public.market_context_policy_decisions
      for select
      using (auth.role() = 'authenticated');
  end if;
end;
$$;

-- updated_at trigger for policies
create or replace function public.update_market_context_policies_updated_at()
returns trigger as $$
begin
    new.updated_at = timezone('utc', now());
    return new;
end;
$$ language plpgsql;

create trigger market_context_policies_updated_at_trg
    before update on public.market_context_policies
    for each row
    execute function public.update_market_context_policies_updated_at();
