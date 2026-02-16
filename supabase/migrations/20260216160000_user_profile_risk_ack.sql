-- Track explicit user risk acknowledgement (versioned).
-- Used by the Vite frontend RiskAcknowledgementGate.

alter table public.user_profile
  add column if not exists risk_acknowledged_at timestamptz,
  add column if not exists risk_version integer not null default 0;
