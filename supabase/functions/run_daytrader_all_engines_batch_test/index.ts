/**
 * Multi-Engine DAYTRADER Batch Test
 * 
 * Runs isolated 30-day backtests for ALL THREE engines:
 * - DAYTRADER V3 (Momentum)
 * - DAYTRADER V3.5 (Precision)
 * - DAYTRADER V4 (Liquidity)
 * 
 * Compares performance and recommends best engine per ticker
 */

import { runIntradayDaytraderBacktestV3 } from '../_shared/backtest_intraday_v3_isolated.ts';
import { runIntradayDaytraderBacktestV35 } from '../_shared/backtest_intraday_v35_isolated.ts';
import { runDaytraderBacktestV4 } from '../_shared/daytrader_backtest_v4.ts';
import { fetchYahooFinanceBars, OHLCBar } from '../_shared/yahoo_finance_bars.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Full ticker universe (48 tickers)
const TICKER_UNIVERSE = [
  'AAPL', 'TSLA', 'MSFT', 'NVDA', 'AMD', 'AMZN', 'META', 'NFLX', 'PLTR',
  'COIN', 'RIVN', 'XOM', 'PG', 'KO', 'JNJ',
  'SPY', 'QQQ', 'IWM', 'TQQQ', 'SOXL',
  'GOOGL', 'SHOP', 'BRK.B', 'NIO', 'MARA', 'RIOT', 'F', 'CRM', 'BABA', 'SMH',
  'JPM', 'BAC', 'GS',
  'UNH', 'ABBV', 'LLY',
  'CVX', 'SLB',
  'DIS', 'MCD', 'WMT',
  'UVXY',
  'MSTR', 'HUT', 'CLSK',
  'ORCL', 'ADBE', 'NOW'
];

// Delay between tickers to avoid Yahoo Finance rate limits
const DELAY_BETWEEN_TICKERS_MS = 3000;

interface EngineResult {
  trades: number;
  winRate: number;
  avgR: number;
  maxDD: number;
  bestTrade: number;
  worstTrade: number;
  totalReturn: number;
}

interface TickerComparison {
  ticker: string;
  v3: EngineResult | null;
  v35: EngineResult | null;
  v4: EngineResult | null;
  recommendation: 'V3' | 'V3_5' | 'V4' | 'DISABLE';
  reason: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  console.log('[Multi-Engine Batch Test] Starting comprehensive test across all engines...');
  
  const results: TickerComparison[] = [];
  const startTime = Date.now();

  for (const ticker of TICKER_UNIVERSE) {
    console.log(`\n========================================`);
    console.log(`[Batch Test] Processing ${ticker}...`);
    console.log(`========================================`);

    try {
      // Fetch 30 days of 5m bars with retry/backoff
      const bars = await fetchWithRetry(ticker, 30, 4);
      
      if (!bars || bars.length < 500) {
        console.warn(`[BATCH] ${ticker} → ${bars?.length || 0} bars (insufficient, need 500+)`);
        results.push({
          ticker,
          v3: null,
          v35: null,
          v4: null,
          recommendation: 'DISABLE',
          reason: 'Insufficient data',
        });
        continue;
      }

      console.log(`[BATCH] ${ticker} → ${bars.length} 5m bars`);

      // Run V3 backtest
      const v3Result = await runBacktestSafe('V3', ticker, bars);

      // Run V3.5 backtest
      const v35Result = await runBacktestSafe('V3_5', ticker, bars);

      // Run V4 backtest
      const v4Result = await runBacktestSafe('V4', ticker, bars);

      // Determine recommendation
      const recommendation = determineRecommendation(ticker, v3Result, v35Result, v4Result);

      results.push({
        ticker,
        v3: v3Result,
        v35: v35Result,
        v4: v4Result,
        recommendation: recommendation.engine,
        reason: recommendation.reason,
      });

      console.log(`[BATCH] ${ticker} V3 → trades=${v3Result?.trades || 0}, avgR=${v3Result?.avgR.toFixed(3) || 'N/A'}, WR=${v3Result?.winRate.toFixed(1) || 'N/A'}%`);
      console.log(`[BATCH] ${ticker} V3_5 → trades=${v35Result?.trades || 0}, avgR=${v35Result?.avgR.toFixed(3) || 'N/A'}, WR=${v35Result?.winRate.toFixed(1) || 'N/A'}%`);
      console.log(`[BATCH] ${ticker} V4 → trades=${v4Result?.trades || 0}, avgR=${v4Result?.avgR.toFixed(3) || 'N/A'}, WR=${v4Result?.winRate.toFixed(1) || 'N/A'}%`);
      console.log(`[BATCH] ${ticker} → RECOMMEND ${recommendation.engine} (${recommendation.reason})`);

    } catch (error) {
      console.error(`[BATCH] ${ticker} backtest ERROR:`, error);
      results.push({
        ticker,
        v3: null,
        v35: null,
        v4: null,
        recommendation: 'DISABLE',
        reason: `Error: ${error.message}`,
      });
      // Wait before next ticker to avoid rate limiting
      if (ticker !== TICKER_UNIVERSE[TICKER_UNIVERSE.length - 1]) {
        console.log(`[BATCH] Waiting ${DELAY_BETWEEN_TICKERS_MS}ms before next ticker...`);
        await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_TICKERS_MS));
      }

    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n========================================`);
  console.log(`[Batch Test] COMPLETE - ${TICKER_UNIVERSE.length} tickers in ${duration}s`);
  console.log(`========================================\n`);

  // Generate summary
  const summary = generateSummary(results);

  // Save results to temp file
  try {
    await Deno.writeTextFile('/tmp/daytrader_multi_engine_batch_results.json', JSON.stringify(results, null, 2));
    console.log('[Batch Test] Results saved to /tmp/daytrader_multi_engine_batch_results.json');
  } catch (e) {
    console.warn('[Batch Test] Could not save results file:', e);
  }

  return new Response(
    JSON.stringify({
      status: 'complete',
      duration_seconds: parseFloat(duration),
      summary,
      results,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
});

/**
 * Fetch 5m bars for a ticker (30-day lookback)
 */
async function fetch5mBars(ticker: string, days: number): Promise<OHLCBar[]> {
  const bars = await fetchYahooFinanceBars(ticker, '5m', days);
  console.log(`[BATCH] ${ticker} fetched → ${bars.length} bars`);
  return bars;
}

// Retry wrapper with exponential backoff for Yahoo Finance rate limits
async function fetchWithRetry(ticker: string, days: number, maxRetries = 3): Promise<OHLCBar[]> {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      const bars = await fetch5mBars(ticker, days);
      return bars;
    } catch (err: any) {
      attempt++;
      const delay = Math.min(8000, Math.pow(2, attempt) * 1000); // 2s, 4s, 8s, capped
      console.warn(`[BATCH] ${ticker} fetch attempt ${attempt}/${maxRetries} failed: ${err?.message || err}. Retrying in ${delay}ms...`);
      if (attempt >= maxRetries) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return [];
}

/**
 * Run backtest safely with error handling
 */
async function runBacktestSafe(
  engine: 'V3' | 'V3_5' | 'V4',
  ticker: string,
  bars: OHLCBar[]
): Promise<EngineResult | null> {
  try {
    let result;
    
    if (engine === 'V3') {
      result = await runIntradayDaytraderBacktestV3({ symbol: ticker, bars });
    } else if (engine === 'V3_5') {
      result = await runIntradayDaytraderBacktestV35({ symbol: ticker, bars });
    } else if (engine === 'V4') {
      // V4 - use true V4 backtest engine
      result = await runDaytraderBacktestV4({ symbol: ticker, bars });
    } else {
      throw new Error(`Unknown engine: ${engine}`);
    }

    if (!result || !result.metrics) {
      console.error(`[BATCH] ${ticker} ${engine} backtest invalid, skipping`);
      return null;
    }

    // Extract best/worst trades from R-multiples
    const trades = result.trades || [];
    let bestTrade = 0;
    let worstTrade = 0;

    if (trades.length > 0) {
      const rValues = trades.map((t: any) => t.r_multiple ?? t.r ?? 0);
      bestTrade = Math.max(...rValues);
      worstTrade = Math.min(...rValues);
    }

    return {
      trades: result.metrics.total_trades || 0,
      winRate: result.metrics.win_rate_pct || 0,
      avgR: result.metrics.avg_R || 0,
      maxDD: result.metrics.max_drawdown_pct || 0,
      bestTrade,
      worstTrade,
      totalReturn: result.metrics.total_return_pct || 0,
    };
  } catch (error) {
    console.error(`[BATCH] ${ticker} ${engine} backtest ERROR:`, error);
    return null;
  }
}

/**
 * Determine best engine for ticker based on results
 */
function determineRecommendation(
  ticker: string,
  v3: EngineResult | null,
  v35: EngineResult | null,
  v4: EngineResult | null
): { engine: 'V3' | 'V3_5' | 'V4' | 'DISABLE'; reason: string } {
  
  // Check if all engines failed
  if (!v3 && !v35 && !v4) {
    return { engine: 'DISABLE', reason: 'All engines failed' };
  }

  // Check disable conditions (all engines poor)
  const allAvgRNegative = (v3?.avgR || 0) < -0.25 && (v35?.avgR || 0) < -0.25 && (v4?.avgR || 0) < -0.25;
  const allWinRateLow = (v3?.winRate || 0) < 12 && (v35?.winRate || 0) < 12 && (v4?.winRate || 0) < 12;
  const allDDHigh = (v3?.maxDD || 0) > 30 && (v35?.maxDD || 0) > 30 && (v4?.maxDD || 0) > 30;

  if (allAvgRNegative) {
    return { engine: 'DISABLE', reason: 'All engines avgR < -0.25' };
  }
  if (allWinRateLow) {
    return { engine: 'DISABLE', reason: 'All engines WR < 12%' };
  }
  if (allDDHigh) {
    return { engine: 'DISABLE', reason: 'All engines DD > 30%' };
  }

  // Find best engine by avgR
  const engines = [
    { name: 'V3' as const, result: v3 },
    { name: 'V3_5' as const, result: v35 },
    { name: 'V4' as const, result: v4 },
  ].filter(e => e.result !== null);

  if (engines.length === 0) {
    return { engine: 'DISABLE', reason: 'No valid results' };
  }

  // Sort by avgR descending
  engines.sort((a, b) => (b.result?.avgR || -999) - (a.result?.avgR || -999));

  const best = engines[0];
  const bestAvgR = best.result?.avgR || 0;

  // If best engine still negative, consider disabling
  if (bestAvgR < -0.15) {
    return { engine: 'DISABLE', reason: `Best engine avgR ${bestAvgR.toFixed(3)} < -0.15` };
  }

  // Require minimum trade frequency
  const bestTrades = best.result?.trades || 0;
  if (bestTrades < 5) {
    return { engine: 'DISABLE', reason: `Insufficient trades (${bestTrades})` };
  }

  return {
    engine: best.name,
    reason: `Best avgR ${bestAvgR.toFixed(3)}, WR ${best.result?.winRate.toFixed(1)}%, ${bestTrades} trades`,
  };
}

/**
 * Generate summary statistics
 */
function generateSummary(results: TickerComparison[]): any {
  const recommendations = {
    V3: results.filter(r => r.recommendation === 'V3').map(r => r.ticker),
    V3_5: results.filter(r => r.recommendation === 'V3_5').map(r => r.ticker),
    V4: results.filter(r => r.recommendation === 'V4').map(r => r.ticker),
    DISABLE: results.filter(r => r.recommendation === 'DISABLE').map(r => r.ticker),
  };

  // Calculate average metrics by engine
  const v3Valid = results.filter(r => r.v3 !== null);
  const v35Valid = results.filter(r => r.v35 !== null);
  const v4Valid = results.filter(r => r.v4 !== null);

  const avgV3 = v3Valid.length > 0 ? {
    avgR: v3Valid.reduce((sum, r) => sum + (r.v3?.avgR || 0), 0) / v3Valid.length,
    winRate: v3Valid.reduce((sum, r) => sum + (r.v3?.winRate || 0), 0) / v3Valid.length,
    trades: v3Valid.reduce((sum, r) => sum + (r.v3?.trades || 0), 0) / v3Valid.length,
  } : null;

  const avgV35 = v35Valid.length > 0 ? {
    avgR: v35Valid.reduce((sum, r) => sum + (r.v35?.avgR || 0), 0) / v35Valid.length,
    winRate: v35Valid.reduce((sum, r) => sum + (r.v35?.winRate || 0), 0) / v35Valid.length,
    trades: v35Valid.reduce((sum, r) => sum + (r.v35?.trades || 0), 0) / v35Valid.length,
  } : null;

  const avgV4 = v4Valid.length > 0 ? {
    avgR: v4Valid.reduce((sum, r) => sum + (r.v4?.avgR || 0), 0) / v4Valid.length,
    winRate: v4Valid.reduce((sum, r) => sum + (r.v4?.winRate || 0), 0) / v4Valid.length,
    trades: v4Valid.reduce((sum, r) => sum + (r.v4?.trades || 0), 0) / v4Valid.length,
  } : null;

  return {
    total_tickers: results.length,
    recommendations,
    counts: {
      V3: recommendations.V3.length,
      V3_5: recommendations.V3_5.length,
      V4: recommendations.V4.length,
      DISABLE: recommendations.DISABLE.length,
    },
    portfolio_avg: {
      V3: avgV3,
      V3_5: avgV35,
      V4: avgV4,
    },
  };
}
