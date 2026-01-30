// @ts-nocheck
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { getCryptoShadowConfig } from '../../config.ts';
import { getCryptoBars, getCryptoLatest } from '../../alpaca_crypto.ts';
import { evaluateRules } from './rules.ts';
import { sizePosition } from './risk_manager.ts';
import {
  fetchOpenPositions,
  loadOrCreatePortfolio,
  markToMarket,
  upsertPortfolioSnapshot,
  upsertPositionAndTrade,
} from './portfolio_sim.ts';

const ENGINE_KEY = 'CRYPTO_V1_SHADOW';
const ENGINE_VERSION: 'v1' = 'v1';

interface TickArgs {
  supabase: SupabaseClient;
  nowUtc: Date;
}
async function logDebug(
  supabase: SupabaseClient,
  now: Date,
  message: string,
  symbol = 'DEBUG',
  timeframe = 'debug',
) {
  const reason = message.slice(0, 200);
  await supabase.from('engine_crypto_signal_decision_log').insert({
    engine_key: ENGINE_KEY,
    version: ENGINE_VERSION,
    symbol,
    timeframe,
    ts: now.toISOString(),
    signal: { msg: reason },
    decision: { decision: 'DEBUG', reason_codes: [reason] },
  });
}

export async function runCryptoShadowTick({ supabase, nowUtc }: TickArgs): Promise<void> {
  const config = getCryptoShadowConfig();
  if (!config.enabled) return;

  await logDebug(supabase, nowUtc, 'tick_start');

  const portfolio = await loadOrCreatePortfolio(supabase);
  if (!portfolio) {
    await logDebug(supabase, nowUtc, 'no_portfolio');
    return;
  }

  // Load open positions and mark-to-market using latest mid
  const openPositions = await fetchOpenPositions(supabase);
  const symbols = Array.from(new Set(config.universe));
  if (!symbols.length) {
    console.warn('[crypto] empty universe, aborting tick');
    return;
  }
  const latestBySymbol: Record<string, number> = {};
  for (const sym of symbols) {
    try {
      const q = await getCryptoLatest(sym);
      if (q?.mid) latestBySymbol[sym] = q.mid;
      else console.warn(`[crypto] no mid quote for ${sym}`);
    } catch (err) {
      console.warn('[crypto] latest quote error', sym, err?.message ?? err);
    }
  }
  for (const pos of openPositions) {
    const mark = latestBySymbol[pos.symbol];
    if (mark) await markToMarket(supabase, [pos], mark);
  }

  const realized = await sumTradesPnl(supabase);
  const unrealized = await sumOpenUnrealized(supabase);
  const equity = portfolio.starting_equity + realized + unrealized;

  // Daily drawdown guard
  const dayStartEquity = portfolio.starting_equity; // approximation
  if (dayStartEquity > 0 && (dayStartEquity - equity) / dayStartEquity >= config.maxDailyDrawdown) {
    console.log('[crypto] daily drawdown lock active, skipping trades');
    await upsertPortfolioSnapshot(supabase, portfolio, equity, equity - unrealized, unrealized, realized, nowUtc);
    return;
  }

  // Max positions guard
  if (openPositions.length >= config.maxConcurrent) {
    await upsertPortfolioSnapshot(supabase, portfolio, equity, equity - unrealized, unrealized, realized, nowUtc);
    return;
  }

  for (const symbol of symbols) {
    for (const timeframe of config.primaryTimeframes) {
      let bars: any[] = [];
      try {
        bars = await getCryptoBars(symbol, timeframe, 300);
      } catch (err) {
        console.warn('[crypto] getCryptoBars error', symbol, timeframe, err?.message ?? err);
      }
      if (!bars.length) {
        console.warn('[crypto] no bars', symbol, timeframe);
        continue;
      }
      // closed candles only: use full array minus in-progress? Alpaca bars are closed bars already.
      let latestQuote = null;
      try {
        latestQuote = await getCryptoLatest(symbol);
      } catch (err) {
        console.warn('[crypto] latest quote error', symbol, err?.message ?? err);
      }
      if (!latestQuote) {
        console.warn('[crypto] missing latest quote', symbol);
        continue;
      }
      const decision = evaluateRules({ symbol, timeframe, bars, latestQuote, config });

      // log filter rejections (not no_trigger)
      if (decision.decision === 'NO_TRADE' && decision.reason_codes?.[0] && decision.reason_codes[0] !== 'no_trigger') {
        await logDecision(supabase, {
          engine_key: ENGINE_KEY,
          version: ENGINE_VERSION,
          symbol,
          timeframe,
          ts: bars[bars.length - 1].ts,
          signal: { close: bars[bars.length - 1].close },
          decision,
        });
        continue;
      }

      if (decision.decision !== 'ENTRY') continue;
      if (!decision.entry || !decision.stop || !decision.tp1 || !decision.tp2 || !decision.side) continue;

      // per-symbol cooldown: skip if last closed trade < 6 bars ago (approx)
      const cooldownOk = await hasCooldownPassed(supabase, symbol, timeframe, bars[bars.length - 1].ts);
      if (!cooldownOk) {
        await logDecision(supabase, {
          engine_key: ENGINE_KEY,
          version: ENGINE_VERSION,
          symbol,
          timeframe,
          ts: bars[bars.length - 1].ts,
          signal: { close: bars[bars.length - 1].close },
          decision: { decision: 'NO_TRADE', reason_codes: ['cooldown'], summary: 'cooldown', explain: [] },
        });
        continue;
      }

      const sizing = sizePosition(equity, decision, config);
      if (!sizing || sizing.qty <= 0) continue;

      const { positionId } = await upsertPositionAndTrade(supabase, portfolio, symbol, decision, sizing, config);
      if (positionId) {
        await logDecision(supabase, {
          engine_key: ENGINE_KEY,
          version: ENGINE_VERSION,
          symbol,
          timeframe,
          ts: bars[bars.length - 1].ts,
          signal: { close: decision.entry },
          decision: { ...decision, sizing },
        });
      }
    }
  }

  // Refresh unrealized after potential entries
  const unrealized2 = await sumOpenUnrealized(supabase);
  const realized2 = await sumTradesPnl(supabase);
  const equity2 = portfolio.starting_equity + realized2 + unrealized2;
  await upsertPortfolioSnapshot(supabase, portfolio, equity2, equity2 - unrealized2, unrealized2, realized2, nowUtc);
  await logDebug(supabase, nowUtc, 'tick_end');
}

async function sumTradesPnl(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from('engine_crypto_trades')
    .select('pnl');
  if (error || !data) return 0;
  return data.reduce((s, r) => s + Number(r.pnl || 0), 0);
}

async function sumOpenUnrealized(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from('engine_crypto_positions')
    .select('unrealized_pnl')
    .eq('status', 'open');
  if (error || !data) return 0;
  return data.reduce((s, r) => s + Number(r.unrealized_pnl || 0), 0);
}

async function logDecision(supabase: SupabaseClient, row: any) {
  const { error } = await supabase.from('engine_crypto_signal_decision_log').insert(row);
  if (error) console.warn('[crypto] decision log insert failed', error);
}

async function hasCooldownPassed(
  supabase: SupabaseClient,
  symbol: string,
  timeframe: string,
  lastBarTs: string,
): Promise<boolean> {
  const tfMs = timeframeMinutes(timeframe) * 60 * 1000;
  const { data, error } = await supabase
    .from('engine_crypto_trades')
    .select('executed_at')
    .eq('symbol', symbol)
    .in('action', ['close', 'stop'])
    .order('executed_at', { ascending: false })
    .limit(1);
  if (error || !data || !data.length) return true;
  const lastClose = Date.parse(data[0].executed_at);
  const lastBar = Date.parse(lastBarTs);
  return lastBar - lastClose >= 6 * tfMs;
}

function timeframeMinutes(tf: string): number {
  const t = tf.toLowerCase();
  if (t === '15m' || t === '15min') return 15;
  if (t === '1h' || t === '60m') return 60;
  return 60;
}
