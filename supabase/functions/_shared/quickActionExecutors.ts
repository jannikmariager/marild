// Action executors for Quick Actions
// Each function fetches data, builds context, and calls AI

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.38.0";
import type { QuickActionRequest, QuickActionResult } from "./quickActionTypes.ts";
import { callQuickActionAI } from "./quickActionAI.ts";
import {
  fetchWatchlistData,
  fetchPortfolioData,
  fetchMarketData,
  fetchSignalsData,
  fetchSectorData,
  fetchEarningsData,
  enrichSymbolsWithMarketData,
} from "./quickActionData.ts";

interface ExecutorParams {
  supabase: SupabaseClient;
  user: { id: string };
  body: QuickActionRequest;
}

/**
 * Analyze user's watchlist
 */
export async function runAnalyzeWatchlist(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { supabase, user, body } = params;

  console.log('[runAnalyzeWatchlist] Starting...');
  const startTime = Date.now();

  // Fetch watchlist
  const watchlist = await fetchWatchlistData(supabase, user.id);
  console.log(`[runAnalyzeWatchlist] Fetched ${watchlist.length} watchlist items in ${Date.now() - startTime}ms`);
  
  if (watchlist.length === 0) {
    return createEmptyResult("analyze-watchlist", "Your watchlist is empty. Add some stocks to get AI analysis.");
  }

  // Get market data for watchlist symbols (limit to 10)
  const symbols = watchlist.map((w) => w.symbol).slice(0, 10);
  console.log(`[runAnalyzeWatchlist] Fetching market data for ${symbols.length} symbols:`, symbols);
  
  const marketDataStart = Date.now();
  const enrichedStocks = await enrichSymbolsWithMarketData(symbols);
  console.log(`[runAnalyzeWatchlist] Market data fetched in ${Date.now() - marketDataStart}ms`);

  const context = {
    userId: user.id,
    action: "analyze-watchlist",
    timeframe: body.timeframe ?? "swing",
    watchlist: enrichedStocks.map((s) => ({
      symbol: s.symbol,
      price: s.quote?.price ?? null,
      change: s.quote?.change ?? null,
      changePercent: s.quote?.changePercent ?? null,
      volume: s.quote?.volume ?? null,
    })),
  };

  return await callQuickActionAI("analyze-watchlist", context);
}

/**
 * Find bullish setups
 */
export async function runFindBullishSetups(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { supabase, user, body } = params;

  // Fetch bullish signals from tradesignal table
  const signals = await fetchSignalsData(supabase, "bullish", 10);

  if (signals.length === 0) {
    return createEmptyResult("find-bullish-setups", "No bullish signals found at the moment. Check back later.");
  }

  // Enrich signals with current market data
  const symbols = signals.map((s) => s.symbol);
  const enrichedSignals = await enrichSymbolsWithMarketData(symbols);

  const context = {
    userId: user.id,
    action: "find-bullish-setups",
    timeframe: body.timeframe ?? "swing",
    signals: signals.map((s, idx) => ({
      symbol: s.symbol,
      signal_type: s.signal_type,
      confidence: s.confidence,
      timeframe: s.timeframe,
      created_at: s.created_at,
      current_price: enrichedSignals[idx]?.quote.price,
      changePercent: enrichedSignals[idx]?.quote.changePercent,
    })),
  };

  return await callQuickActionAI("find-bullish-setups", context);
}

/**
 * Scan for breakouts
 */
export async function runScanBreakouts(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { supabase, user, body } = params;

  // Fetch breakout signals
  const signals = await fetchSignalsData(supabase, "breakout", 10);

  if (signals.length === 0) {
    return createEmptyResult("scan-breakouts", "No breakout patterns detected currently.");
  }

  const symbols = signals.map((s) => s.symbol);
  const enrichedSignals = await enrichSymbolsWithMarketData(symbols);

  const context = {
    userId: user.id,
    action: "scan-breakouts",
    timeframe: body.timeframe ?? "swing",
    breakouts: signals.map((s, idx) => ({
      symbol: s.symbol,
      confidence: s.confidence,
      current_price: enrichedSignals[idx]?.quote.price,
      volume: enrichedSignals[idx]?.quote.volume,
      changePercent: enrichedSignals[idx]?.quote.changePercent,
    })),
  };

  return await callQuickActionAI("scan-breakouts", context);
}

/**
 * Check sector rotation
 */
export async function runCheckSectorRotation(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { user, body } = params;

  // Fetch sector performance data
  const sectors = await fetchSectorData();

  const context = {
    userId: user.id,
    action: "check-sector-rotation",
    timeframe: body.timeframe ?? "swing",
    sectors,
  };

  return await callQuickActionAI("check-sector-rotation", context);
}

/**
 * Review portfolio risk
 */
export async function runReviewPortfolioRisk(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { supabase, user, body } = params;

  // Fetch portfolio positions
  const portfolio = await fetchPortfolioData(supabase, user.id);

  if (portfolio.length === 0) {
    return createEmptyResult("review-portfolio-risk", "No portfolio positions found. Add positions to get risk analysis.");
  }

  // Enrich with market data
  const symbols = portfolio.map((p) => p.symbol);
  const enrichedPositions = await enrichSymbolsWithMarketData(symbols);

  // Calculate basic metrics
  const totalValue = portfolio.reduce((sum, p) => {
    const currentPrice = enrichedPositions.find((e) => e.symbol === p.symbol)?.quote.price ?? p.cost_basis;
    return sum + (currentPrice * p.quantity);
  }, 0);

  const context = {
    userId: user.id,
    action: "review-portfolio-risk",
    timeframe: body.timeframe ?? "position",
    portfolio: portfolio.map((p, idx) => {
      const quote = enrichedPositions[idx]?.quote;
      const currentPrice = quote?.price ?? p.cost_basis;
      const currentValue = currentPrice * p.quantity;
      const costBasisTotal = p.cost_basis * p.quantity;
      const unrealizedPnl = currentValue - costBasisTotal;
      const pnlPercent = (unrealizedPnl / costBasisTotal) * 100;
      const positionWeight = (currentValue / totalValue) * 100;

      return {
        symbol: p.symbol,
        quantity: p.quantity,
        cost_basis: p.cost_basis,
        current_price: currentPrice,
        unrealized_pnl: unrealizedPnl,
        pnl_percent: pnlPercent,
        position_weight: positionWeight,
        changePercent: quote?.changePercent ?? 0,
      };
    }),
    total_value: totalValue,
  };

  return await callQuickActionAI("review-portfolio-risk", context);
}

/**
 * Find bearish setups
 */
export async function runFindBearishSetups(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { supabase, user, body } = params;

  // Fetch bearish signals
  const signals = await fetchSignalsData(supabase, "bearish", 10);

  if (signals.length === 0) {
    return createEmptyResult("find-bearish-setups", "No bearish signals found at the moment.");
  }

  const symbols = signals.map((s) => s.symbol);
  const enrichedSignals = await enrichSymbolsWithMarketData(symbols);

  const context = {
    userId: user.id,
    action: "find-bearish-setups",
    timeframe: body.timeframe ?? "swing",
    signals: signals.map((s, idx) => ({
      symbol: s.symbol,
      signal_type: s.signal_type,
      confidence: s.confidence,
      timeframe: s.timeframe,
      created_at: s.created_at,
      current_price: enrichedSignals[idx]?.quote.price,
      changePercent: enrichedSignals[idx]?.quote.changePercent,
    })),
  };

  return await callQuickActionAI("find-bearish-setups", context);
}

/**
 * Upcoming earnings analysis
 */
export async function runUpcomingEarnings(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { user, body } = params;

  // Fetch earnings calendar
  const earnings = await fetchEarningsData();

  if (earnings.length === 0) {
    return createEmptyResult("upcoming-earnings", "No major earnings events this week.");
  }

  // Enrich with market data
  const symbols = earnings.map((e) => e.symbol);
  const enrichedEarnings = await enrichSymbolsWithMarketData(symbols);

  const context = {
    userId: user.id,
    action: "upcoming-earnings",
    timeframe: body.timeframe ?? "intraday",
    earnings: earnings.map((e, idx) => ({
      symbol: e.symbol,
      date: e.date,
      current_price: enrichedEarnings[idx]?.quote.price,
      changePercent: enrichedEarnings[idx]?.quote.changePercent,
      volume: enrichedEarnings[idx]?.quote.volume,
    })),
  };

  return await callQuickActionAI("upcoming-earnings", context);
}

/**
 * Find oversold stocks
 */
export async function runFindOversoldStocks(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { supabase, user, body } = params;

  // Fetch oversold signals
  const signals = await fetchSignalsData(supabase, "oversold", 10);

  if (signals.length === 0) {
    return createEmptyResult("find-oversold-stocks", "No oversold stocks detected currently.");
  }

  const symbols = signals.map((s) => s.symbol);
  const enrichedSignals = await enrichSymbolsWithMarketData(symbols);

  const context = {
    userId: user.id,
    action: "find-oversold-stocks",
    timeframe: body.timeframe ?? "swing",
    signals: signals.map((s, idx) => ({
      symbol: s.symbol,
      signal_type: s.signal_type,
      confidence: s.confidence,
      current_price: enrichedSignals[idx]?.quote.price,
      changePercent: enrichedSignals[idx]?.quote.changePercent,
    })),
  };

  return await callQuickActionAI("find-oversold-stocks", context);
}

/**
 * Find overbought stocks
 */
export async function runFindOverboughtStocks(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { supabase, user, body } = params;

  // For now, use bullish signals as proxy for overbought (stocks at highs)
  const signals = await fetchSignalsData(supabase, "bullish", 10);

  if (signals.length === 0) {
    return createEmptyResult("find-overbought-stocks", "No overbought conditions detected.");
  }

  const symbols = signals.map((s) => s.symbol);
  const enrichedSignals = await enrichSymbolsWithMarketData(symbols);

  const context = {
    userId: user.id,
    action: "find-overbought-stocks",
    timeframe: body.timeframe ?? "swing",
    stocks: signals.map((s, idx) => ({
      symbol: s.symbol,
      current_price: enrichedSignals[idx]?.quote.price,
      changePercent: enrichedSignals[idx]?.quote.changePercent,
      volume: enrichedSignals[idx]?.quote.volume,
    })),
  };

  return await callQuickActionAI("find-overbought-stocks", context);
}

/**
 * Detect trend reversals
 */
export async function runDetectTrendReversals(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { supabase, user, body } = params;

  // Fetch mixed signals (both bullish and bearish for reversal candidates)
  const bullishSignals = await fetchSignalsData(supabase, "bullish", 5);
  const bearishSignals = await fetchSignalsData(supabase, "bearish", 5);
  const allSignals = [...bullishSignals, ...bearishSignals];

  if (allSignals.length === 0) {
    return createEmptyResult("detect-trend-reversals", "No trend reversal patterns detected.");
  }

  const symbols = allSignals.map((s) => s.symbol);
  const enrichedSignals = await enrichSymbolsWithMarketData(symbols);

  const context = {
    userId: user.id,
    action: "detect-trend-reversals",
    timeframe: body.timeframe ?? "swing",
    reversals: allSignals.map((s, idx) => ({
      symbol: s.symbol,
      signal_type: s.signal_type,
      confidence: s.confidence,
      current_price: enrichedSignals[idx]?.quote.price,
      changePercent: enrichedSignals[idx]?.quote.changePercent,
    })),
  };

  return await callQuickActionAI("detect-trend-reversals", context);
}

/**
 * Analyze volatility risk regime
 */
export async function runVolatilityRiskRegime(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { user, body } = params;

  // Fetch major indices for volatility analysis
  const symbols = ["SPY", "QQQ", "VIX", "IWM"];
  const marketData = await enrichSymbolsWithMarketData(symbols);

  const context = {
    userId: user.id,
    action: "volatility-risk-regime",
    timeframe: body.timeframe ?? "swing",
    indices: marketData.map((m) => ({
      symbol: m.symbol,
      price: m.quote.price,
      changePercent: m.quote.changePercent,
      volume: m.quote.volume,
    })),
  };

  return await callQuickActionAI("volatility-risk-regime", context);
}

/**
 * Provide macro briefing
 */
export async function runMacroBriefing(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { user, body } = params;

  // Fetch key macro indicators
  const symbols = ["SPY", "TLT", "GLD", "UUP", "HYG"];
  const macroData = await enrichSymbolsWithMarketData(symbols);
  const sectors = await fetchSectorData();

  const context = {
    userId: user.id,
    action: "macro-briefing",
    timeframe: body.timeframe ?? "position",
    macro_indicators: macroData.map((m) => ({
      symbol: m.symbol,
      price: m.quote.price,
      changePercent: m.quote.changePercent,
    })),
    sector_performance: sectors,
  };

  return await callQuickActionAI("macro-briefing", context);
}

/**
 * Find momentum leaders
 */
export async function runFindMomentumLeaders(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { supabase, user, body } = params;

  // Fetch strongest bullish signals as momentum leaders
  const signals = await fetchSignalsData(supabase, "bullish", 10);

  if (signals.length === 0) {
    return createEmptyResult("find-momentum-leaders", "No momentum leaders identified currently.");
  }

  const symbols = signals.map((s) => s.symbol);
  const enrichedSignals = await enrichSymbolsWithMarketData(symbols);

  const context = {
    userId: user.id,
    action: "find-momentum-leaders",
    timeframe: body.timeframe ?? "swing",
    leaders: signals.map((s, idx) => ({
      symbol: s.symbol,
      confidence: s.confidence,
      current_price: enrichedSignals[idx]?.quote.price,
      changePercent: enrichedSignals[idx]?.quote.changePercent,
      volume: enrichedSignals[idx]?.quote.volume,
    })),
  };

  return await callQuickActionAI("find-momentum-leaders", context);
}

/**
 * Find high short interest stocks
 */
export async function runHighShortInterest(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { supabase, user, body } = params;

  // Use signals data as proxy for high-interest stocks
  const signals = await fetchSignalsData(supabase, "bullish", 10);

  if (signals.length === 0) {
    return createEmptyResult("high-short-interest", "No high short interest opportunities detected.");
  }

  const symbols = signals.map((s) => s.symbol);
  const enrichedSignals = await enrichSymbolsWithMarketData(symbols);

  const context = {
    userId: user.id,
    action: "high-short-interest",
    timeframe: body.timeframe ?? "swing",
    stocks: signals.map((s, idx) => ({
      symbol: s.symbol,
      confidence: s.confidence,
      current_price: enrichedSignals[idx]?.quote.price,
      changePercent: enrichedSignals[idx]?.quote.changePercent,
      volume: enrichedSignals[idx]?.quote.volume,
    })),
  };

  return await callQuickActionAI("high-short-interest", context);
}

/**
 * Analyze market sentiment
 */
export async function runAnalyzeMarketSentiment(
  params: ExecutorParams
): Promise<QuickActionResult> {
  const { user, body } = params;

  // Fetch sentiment indicators
  const symbols = ["SPY", "VIX", "QQQ", "IWM", "DIA"];
  const sentimentData = await enrichSymbolsWithMarketData(symbols);

  const context = {
    userId: user.id,
    action: "analyze-market-sentiment",
    timeframe: body.timeframe ?? "intraday",
    indicators: sentimentData.map((m) => ({
      symbol: m.symbol,
      price: m.quote?.price ?? null,
      changePercent: m.quote?.changePercent ?? null,
      volume: m.quote?.volume ?? null,
    })),
  };

  return await callQuickActionAI("analyze-market-sentiment", context);
}

/**
 * Helper to create empty result when no data is available
 */
function createEmptyResult(
  action: string,
  message: string
): QuickActionResult {
  return {
    action: action as any,
    generatedAt: new Date().toISOString(),
    headline: "No data available",
    summary: message,
    insights: [],
    disclaimer:
      "This is informational AI-generated analysis only, not financial advice.",
  };
}
