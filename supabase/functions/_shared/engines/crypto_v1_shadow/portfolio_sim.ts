import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import type { PortfolioRow, PositionRow, RuleDecision, SizingResult } from './types.ts';
import { applyFeeSlippage } from './risk_manager.ts';
import type { CryptoShadowConfig } from '../../config.ts';

const ENGINE_KEY = 'CRYPTO_V1_SHADOW';
const ENGINE_VERSION = 'v1';

export async function loadOrCreatePortfolio(supabase: SupabaseClient): Promise<PortfolioRow | null> {
  const { data, error } = await supabase
    .from('engine_portfolios')
    .select('*')
    .eq('engine_key', ENGINE_KEY)
    .eq('engine_version', ENGINE_VERSION)
    .eq('run_mode', 'SHADOW')
    .maybeSingle();

  if (error) {
    console.error('[crypto] load portfolio error', error);
    return null;
  }
  if (data) return data as PortfolioRow;

  const { data: inserted, error: insertErr } = await supabase
    .from('engine_portfolios')
    .insert({
      engine_key: ENGINE_KEY,
      engine_version: ENGINE_VERSION,
      run_mode: 'SHADOW',
      asset_class: 'crypto',
      base_currency: 'USD',
      name: 'CRYPTO Shadow',
      starting_equity: 100000,
      equity: 100000,
    })
    .select('*')
    .maybeSingle();
  if (insertErr) {
    console.error('[crypto] insert portfolio error', insertErr);
    return null;
  }
  return inserted as PortfolioRow;
}

export async function fetchOpenPositions(supabase: SupabaseClient): Promise<PositionRow[]> {
  const { data, error } = await supabase
    .from('engine_crypto_positions')
    .select('*')
    .eq('engine_key', ENGINE_KEY)
    .eq('version', ENGINE_VERSION)
    .eq('status', 'open');
  if (error) {
    console.error('[crypto] fetchOpenPositions error', error);
    return [];
  }
  return data as PositionRow[];
}

export async function upsertPositionAndTrade(
  supabase: SupabaseClient,
  portfolio: PortfolioRow,
  symbol: string,
  decision: RuleDecision,
  sizing: SizingResult,
  config: CryptoShadowConfig,
): Promise<{ positionId: string | null }> {
  const side = decision.side === 'long' ? 'buy' : 'sell';
  const entryPrice = applyFeeSlippage(decision.entry!, config, side);

  const { data: pos, error: posErr } = await supabase
    .from('engine_crypto_positions')
    .insert({
      engine_key: ENGINE_KEY,
      version: ENGINE_VERSION,
      portfolio_id: portfolio.id,
      symbol,
      side: decision.side,
      qty: sizing.qty,
      avg_entry_price: entryPrice,
      stop_loss: decision.stop,
      take_profit1: decision.tp1,
      take_profit2: decision.tp2,
      realized_pnl: 0,
      unrealized_pnl: 0,
      status: 'open',
      meta: {},
    })
    .select('id')
    .maybeSingle();

  if (posErr || !pos?.id) {
    console.error('[crypto] insert position failed', posErr);
    return { positionId: null };
  }

  const { error: tradeErr } = await supabase.from('engine_crypto_trades').insert({
    engine_key: ENGINE_KEY,
    version: ENGINE_VERSION,
    portfolio_id: portfolio.id,
    position_id: pos.id,
    symbol,
    action: 'open',
    side,
    qty: sizing.qty,
    price: entryPrice,
    fee: sizing.notional * (config.feeBps / 10000),
    pnl: 0,
    meta: { R: sizing.R },
  });

  if (tradeErr) {
    console.error('[crypto] insert trade failed', tradeErr);
  }

  return { positionId: pos.id };
}

export async function closePosition(
  supabase: SupabaseClient,
  position: PositionRow,
  price: number,
  action: 'close' | 'stop' | 'tp1' | 'tp2',
  fee: number,
) {
  const pnl = (position.side === 'long' ? price - position.avg_entry_price : position.avg_entry_price - price) * position.qty - fee;

  const { error: tradeErr } = await supabase.from('engine_crypto_trades').insert({
    engine_key: ENGINE_KEY,
    version: ENGINE_VERSION,
    portfolio_id: position.portfolio_id,
    position_id: position.id,
    symbol: position.symbol,
    action,
    side: position.side === 'long' ? 'sell' : 'buy',
    qty: position.qty,
    price,
    fee,
    pnl,
    meta: {},
  });
  if (tradeErr) console.error('[crypto] trade insert on close failed', tradeErr);

  const { error: posErr } = await supabase
    .from('engine_crypto_positions')
    .update({
      status: 'closed',
      closed_at: new Date().toISOString(),
      realized_pnl: position.realized_pnl + pnl,
      unrealized_pnl: 0,
      meta: { ...position.meta, last_close_action: action },
    })
    .eq('id', position.id);
  if (posErr) console.error('[crypto] position close update failed', posErr);
}

export async function markToMarket(
  supabase: SupabaseClient,
  positions: PositionRow[],
  markPrice: number,
): Promise<void> {
  if (!positions.length) return;
  const updates = positions.map((p) => {
    const unreal = (p.side === 'long' ? markPrice - p.avg_entry_price : p.avg_entry_price - markPrice) * p.qty;
    return { id: p.id, unrealized_pnl: unreal };
  });
  const { error } = await supabase.from('engine_crypto_positions').upsert(updates, { onConflict: 'id' });
  if (error) console.error('[crypto] markToMarket upsert failed', error);
}

export async function upsertPortfolioSnapshot(
  supabase: SupabaseClient,
  portfolio: PortfolioRow,
  equity: number,
  cash: number,
  unrealized: number,
  realized: number,
  ts: Date,
) {
  const hourTs = new Date(ts);
  hourTs.setMinutes(0, 0, 0);
  const iso = hourTs.toISOString();
  const { error } = await supabase.from('engine_crypto_portfolio_state').upsert(
    {
      engine_key: ENGINE_KEY,
      version: ENGINE_VERSION,
      portfolio_id: portfolio.id,
      ts: iso,
      equity,
      cash,
      unrealized,
      realized,
    },
    { onConflict: 'engine_key,version,portfolio_id,ts' },
  );
  if (error) console.error('[crypto] upsert portfolio snapshot failed', error);
}
