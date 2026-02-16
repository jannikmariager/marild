-- 20260216112000_admin_role_and_audit_log.sql
-- Admin v2: RBAC + audit logging primitives

-- A) Add role column to user_profile
alter table public.user_profile
  add column if not exists role text not null default 'user';

-- Optional but recommended: constrain role values (idempotent)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_profile_role_check'
  ) then
    alter table public.user_profile
      add constraint user_profile_role_check
      check (role in ('user', 'admin'));
  end if;
end;
$$;

-- B) Create admin audit log table
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null,
  action text not null,
  entity text not null,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists admin_audit_log_created_at_desc_idx
  on public.admin_audit_log (created_at desc);

create index if not exists admin_audit_log_admin_id_created_at_desc_idx
  on public.admin_audit_log (admin_id, created_at desc);

-- C) Keep RLS strict. Admin API routes use service role + server-side RBAC enforcement.
-- Enable RLS on admin_audit_log (safe; service_role bypasses RLS).
alter table public.admin_audit_log enable row level security;

-- service_role full access policy (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_audit_log'
      and policyname = 'service_role_all_admin_audit_log'
  ) then
    create policy service_role_all_admin_audit_log
      on public.admin_audit_log
      for all
      using (auth.role() = 'service_role');
  end if;
end;
$$;
