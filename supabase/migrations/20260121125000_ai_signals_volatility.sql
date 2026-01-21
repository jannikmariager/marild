-- Add volatility metadata to ai_signals
alter table public.ai_signals
  add column if not exists volatility_state text not null default 'NORMAL',
  add column if not exists volatility_percentile integer,
  add column if not exists volatility_explanation text,
  add column if not exists volatility_atr numeric;

update public.ai_signals
set volatility_state = coalesce(volatility_state, 'NORMAL'),
    volatility_explanation = coalesce(volatility_explanation, 'Legacy signal without volatility context.')
where volatility_state is null
   or volatility_explanation is null;
