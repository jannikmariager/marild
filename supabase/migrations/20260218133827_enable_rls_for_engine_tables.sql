-- Enable RLS on engine/admin tables to satisfy linter, keeping access admin-only.

ALTER TABLE public.daily_focus_tickers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.realtime_market_data           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_active_symbols           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bars_1m                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_run_log                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticker_engine_owner            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engine_ticker_score_history    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_feature_flags              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_log                  ENABLE ROW LEVEL SECURITY;

-- Prevent anon/authenticated from using these tables directly. Admin APIs
-- use the service role client and will continue to work as before.
REVOKE ALL ON public.daily_focus_tickers         FROM anon, authenticated;
REVOKE ALL ON public.realtime_market_data        FROM anon, authenticated;
REVOKE ALL ON public.daily_active_symbols        FROM anon, authenticated;
REVOKE ALL ON public.bars_1m                     FROM anon, authenticated;
REVOKE ALL ON public.job_run_log                 FROM anon, authenticated;
REVOKE ALL ON public.ticker_engine_owner         FROM anon, authenticated;
REVOKE ALL ON public.engine_ticker_score_history FROM anon, authenticated;
REVOKE ALL ON public.app_feature_flags           FROM anon, authenticated;
REVOKE ALL ON public.promotion_log               FROM anon, authenticated;