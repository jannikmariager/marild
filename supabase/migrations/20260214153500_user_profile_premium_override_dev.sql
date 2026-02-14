-- Add a simple DB-backed entitlement override for development/admin testing.
-- This is checked by the API entitlement helper.

alter table public.user_profile
  add column if not exists premium_override_dev boolean not null default false;
