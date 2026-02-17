-- User attribution capture and per-user attribution state.

create table if not exists public.user_attributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null,
  details text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id)
);

alter table public.user_attributions enable row level security;

create policy "Users can select their own attribution" on public.user_attributions
  for select
  using (auth.uid() = user_id);

create policy "Users can insert their own attribution" on public.user_attributions
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own attribution" on public.user_attributions
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


create table if not exists public.user_attribution_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  login_count integer not null default 0,
  dismissed_until timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_attribution_state enable row level security;

create policy "Users can select their own attribution state" on public.user_attribution_state
  for select
  using (auth.uid() = user_id);

create policy "Users can upsert their own attribution state" on public.user_attribution_state
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


create index if not exists idx_user_attributions_user_id on public.user_attributions(user_id);
