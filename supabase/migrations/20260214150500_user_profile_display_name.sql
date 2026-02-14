-- Add display_name to user_profile so the app can store a user-editable name.
-- Notifications preferences are intentionally not added yet.

alter table public.user_profile
  add column if not exists display_name text;

-- Optional: keep updated_at fresh when display_name changes.
-- If you already have an updated_at trigger, you can remove this block.
-- (No-op if updated_at column doesn't exist.)
