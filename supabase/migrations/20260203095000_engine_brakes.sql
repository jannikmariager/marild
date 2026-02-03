-- 20260203095000_engine_brakes.sql
-- Add JSON settings to engine_versions, create engine_daily_state, and seed SHADOW_BRAKES_V1

-- 1) Extend engine_versions with settings jsonb
alter table public.engine_versions
  add column if not exists settings jsonb not null default '{}'::jsonb;

-- 2) Create engine_daily_state table
create table if not exists public.engine_daily_state (
  engine_key text not null,
  engine_version text not null,
  trading_day date not null,
  state text not null,
  daily_pnl numeric not null default 0,
  trades_count integer not null default 0,
  throttle_factor numeric not null default 1,
  halt_reason text null,
  updated_at timestamptz not null default timezone('utc', now()),
  constraint engine_daily_state_pkey primary key (engine_key, engine_version, trading_day)
);

alter table public.engine_daily_state enable row level security;

-- service_role full access policy (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'engine_daily_state'
      and policyname = 'service_role_all_engine_daily_state'
  ) then
    create policy service_role_all_engine_daily_state
      on public.engine_daily_state
      for all
      using (auth.role() = 'service_role');
  end if;
end;
$$;

-- 3) Seed SHADOW_BRAKES_V1 engine version (shadow SWING engine)
insert into public.engine_versions (engine_key, engine_version, run_mode, asset_class, is_enabled, is_user_visible)
select 'SWING', 'SHADOW_BRAKES_V1', 'SHADOW', 'stocks', true, true
where not exists (
  select 1 from public.engine_versions
  where engine_key = 'SWING'
    and engine_version = 'SHADOW_BRAKES_V1'
    and run_mode = 'SHADOW'
);

-- 4) Overlay brakes config into live SWING PRIMARY engine and SHADOW_BRAKES_V1
do $$
declare
  live_version text;
begin
  -- Find the most recent PRIMARY SWING engine_version (live engine)
  select ev.engine_version
  into live_version
  from public.engine_versions ev
  where ev.engine_key = 'SWING'
    and ev.run_mode = 'PRIMARY'
  order by ev.created_at desc
  limit 1;

  if live_version is not null then
    -- Live SWING: soft brake only (throttle at +800, no hard stop)
    update public.engine_versions ev
    set settings = coalesce(ev.settings, '{}'::jsonb) || jsonb_build_object(
      'brakes', jsonb_build_object(
        'soft_enabled', true,
        'soft_lock_pnl', 800,
        'throttle_factor', 0.3,
        'hard_enabled', false
      )
    )
    where ev.engine_key = 'SWING'
      and ev.engine_version = live_version
      and ev.run_mode = 'PRIMARY';

    -- Shadow brakes engine: full brakes config
    update public.engine_versions ev
    set settings = coalesce(ev.settings, '{}'::jsonb) || jsonb_build_object(
      'brakes', jsonb_build_object(
        'enabled', true,
        'soft_lock_pnl', 800,
        'hard_lock_pnl', 1500,
        'max_daily_loss', -500,
        'max_trades_per_day', 25,
        'throttle_factor', 0.3,
        'base_engine_version', live_version
      )
    )
    where ev.engine_key = 'SWING'
      and ev.engine_version = 'SHADOW_BRAKES_V1'
      and ev.run_mode = 'SHADOW';
  end if;
end;
$$;
