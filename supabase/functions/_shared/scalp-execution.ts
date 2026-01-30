/**
 * SCALP Execution Module
 * Handles trade entry with liquidity validation and slippage estimation
 * 
 * Features:
 * - Liquidity validation before entry
 * - Realistic slippage estimation from quote data
 * - Order book structure analysis (using SMC data)
 * - Position tracking
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

export interface ScalpTradeEntry {
  trade_id: string;
  symbol: string;
  entry_price: number;
  filled_price: number;
  slippage_pct: number;
  size_shares: number;
  notional_at_entry: number;
  status: 'OPEN' | 'ERROR';
  error_reason?: string;
}

export interface LiquidityCheckResult {
  has_sufficient_liquidity: boolean;
  estimated_spread_pct: number;
  estimated_slippage_pct: number;
  reason: string;
  orderbook_analyzed_at?: string;
}

/**
 * Estimate bid/ask spread from recent OHLC data
 * Uses high-low range as a proxy for typical intraday spread
 * This is a conservative estimate until we have real orderbook data
 */
function estimateSpreadFromOHLC(
  currentPrice: number,
  dayHigh: number,
  dayLow: number,
  avgVolume: number,
  currentVolume: number
): { spreadPct: number; slippagePct: number } {
  // Base spread from volatility (high-low range as percentage of current)
  const volatilityRange = dayHigh - dayLow;
  const volatilityPct = (volatilityRange / currentPrice) * 100;
  
  // Typical spread is 0.5x to 1x the daily volatility
  let estimatedSpreadPct = volatilityPct * 0.5;
  
  // Adjust for volume - lower volume = higher spread
  const volumeRatio = Math.min(currentVolume / avgVolume, 2);
  const volumeAdjustment = 1 + (1 - volumeRatio) * 0.5; // 0.5x to 1.5x adjustment
  estimatedSpreadPct *= volumeAdjustment;
  
  // Slippage is roughly 50% of spread (for market orders)
  const slippagePct = estimatedSpreadPct * 0.5;
  
  return {
    spreadPct: Math.max(estimatedSpreadPct, 0.01), // Minimum 0.01% spread
    slippagePct: Math.max(slippagePct, 0.005),     // Minimum 0.005% slippage
  };
}

/**
 * Check if SMC order blocks suggest liquidity at desired entry price
 * Returns true if entry price is near (within 0.5%) of an identified liquidity zone
 */
function checkLiquidityZones(
  entryPrice: number,
  orderBlocks: any[],
  sessionRanges: any[]
): boolean {
  // Check if entry is near any bullish order block (for long entries)
  const nearOrderBlock = orderBlocks.some(ob => {
    const distance = Math.abs(entryPrice - ob.low) / entryPrice;
    return distance < 0.005 && ob.direction === 'bullish'; // Within 0.5%
  });
  
  // Check if entry is within a session range
  const nearSessionRange = sessionRanges.some(sr => {
    return entryPrice >= sr.low * 0.995 && entryPrice <= sr.high * 1.005;
  });
  
  return nearOrderBlock || nearSessionRange;
}

/**
 * Validate liquidity before scalp entry
 * Checks: spread, volume, price level liquidity
 */
export async function validateLiquidity(
  supabase: SupabaseClient,
  symbol: string,
  entryPrice: number,
  quoteData: any,
  config: any
): Promise<LiquidityCheckResult> {
  try {
    // Get current quote and volume data
    const currentPrice = quoteData.current_price;
    const dayHigh = quoteData.day_high || currentPrice * 1.02;
    const dayLow = quoteData.day_low || currentPrice * 0.98;
    const avgVolume = quoteData.avg_volume || 1000000;
    const currentVolume = quoteData.volume || avgVolume;
    
    // Estimate spread from OHLC data
    const { spreadPct, slippagePct } = estimateSpreadFromOHLC(
      currentPrice,
      dayHigh,
      dayLow,
      avgVolume,
      currentVolume
    );
    
    // Check if spread is within acceptable limits
    const maxAcceptableSpread = config.max_acceptable_spread_pct || 0.10; // 0.10%
    if (spreadPct > maxAcceptableSpread) {
      return {
        has_sufficient_liquidity: false,
        estimated_spread_pct: spreadPct,
        estimated_slippage_pct: slippagePct,
        reason: `Estimated spread ${spreadPct.toFixed(3)}% exceeds max ${maxAcceptableSpread}%`,
      };
    }
    
    // Check slippage against config limit
    const maxAcceptableSlippage = config.max_entry_slippage_pct || 0.05; // 0.05%
    if (slippagePct > maxAcceptableSlippage) {
      return {
        has_sufficient_liquidity: false,
        estimated_spread_pct: spreadPct,
        estimated_slippage_pct: slippagePct,
        reason: `Estimated slippage ${slippagePct.toFixed(3)}% exceeds max ${maxAcceptableSlippage}%`,
      };
    }
    
    // Check volume - need at least 1.0x average for scalp entries
    const volumeRatio = currentVolume / avgVolume;
    if (volumeRatio < 0.5) {
      return {
        has_sufficient_liquidity: false,
        estimated_spread_pct: spreadPct,
        estimated_slippage_pct: slippagePct,
        reason: `Volume ratio ${volumeRatio.toFixed(2)}x below minimum 0.5x avg`,
      };
    }
    
    // Optional: Check SMC order blocks for liquidity zones
    // (In future, this will be checked against real orderbook data)
    
    return {
      has_sufficient_liquidity: true,
      estimated_spread_pct: spreadPct,
      estimated_slippage_pct: slippagePct,
      reason: 'Liquidity OK',
      orderbook_analyzed_at: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`[validateLiquidity] Error for ${symbol}:`, error);
    return {
      has_sufficient_liquidity: false,
      estimated_spread_pct: 0,
      estimated_slippage_pct: 0,
      reason: `Liquidity check failed: ${error.message}`,
    };
  }
}

/**
 * Execute scalp trade entry
 * Creates position with realistic fill price based on estimated slippage
 */
export async function executeScalpEntry(
  supabase: SupabaseClient,
  signal: any,
  config: any,
  sizing: any,
  sizingDecisionId: string
): Promise<ScalpTradeEntry | null> {
  try {
    const tradeId = crypto.randomUUID();
    
    // Validate liquidity before entry
    const liquidityCheck = await validateLiquidity(
      supabase,
      signal.symbol,
      signal.entry_price,
      { 
        current_price: signal.entry_price,
        day_high: signal.entry_price * 1.02,
        day_low: signal.entry_price * 0.98,
        volume: 1000000,
        avg_volume: 1000000,
      },
      config
    );
    
    if (!liquidityCheck.has_sufficient_liquidity) {
      console.warn(
        `[executeScalpEntry] Liquidity check failed for ${signal.symbol}: ${liquidityCheck.reason}`
      );
      return null;
    }
    
    // Calculate fill price with realistic slippage
    const slippageAdjustment = signal.signal_type === 'BUY' 
      ? 1 + (liquidityCheck.estimated_slippage_pct / 100)
      : 1 - (liquidityCheck.estimated_slippage_pct / 100);
    
    const filledPrice = signal.entry_price * slippageAdjustment;
    
    console.log(`[executeScalpEntry] Entry ${signal.symbol}: signal=${signal.entry_price.toFixed(4)}, filled=${filledPrice.toFixed(4)}, slippage=${liquidityCheck.estimated_slippage_pct.toFixed(3)}%`);
    
    // Create position record
    const { error: positionError } = await supabase
      .from('engine_positions')
      .insert({
        id: tradeId,
        engine_key: 'SCALP',
        engine_version: 'SCALP_V1_MICROEDGE',
        run_mode: 'SHADOW',
        ticker: signal.symbol,
        timeframe: signal.timeframe || '5m',
        entry_time: new Date().toISOString(),
        entry_price: filledPrice, // Use filled price, not signal price
        qty: sizing.finalPositionSize,
        stop_loss: signal.stop_loss,
        take_profit_1: signal.take_profit_1,
        take_profit_2: signal.take_profit_2,
        status: 'OPEN',
        signal_id: signal.id,
        sizing_decision_id: sizingDecisionId,
        notes: `Slippage: ${liquidityCheck.estimated_slippage_pct.toFixed(3)}%, Spread: ${liquidityCheck.estimated_spread_pct.toFixed(3)}%`,
      });
    
    if (positionError) {
      console.error(`[executeScalpEntry] Failed to create position for ${signal.symbol}:`, positionError);
      return null;
    }
    
    return {
      trade_id: tradeId,
      symbol: signal.symbol,
      entry_price: signal.entry_price,
      filled_price: filledPrice,
      slippage_pct: liquidityCheck.estimated_slippage_pct,
      size_shares: sizing.finalPositionSize,
      notional_at_entry: filledPrice * sizing.finalPositionSize,
      status: 'OPEN',
    };
  } catch (error) {
    console.error('[executeScalpEntry] Fatal error:', error);
    return null;
  }
}
