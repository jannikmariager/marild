/**
 * Backtest API Route
 * Run or retrieve cached AI backtests via Edge Function
 * PRO-only feature - NO OpenAI calls
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabaseServer";
import { devForcePro } from "@/lib/subscription/devOverride";
import { loadApprovedTickers } from "@/lib/approvedTickers";

const CACHE_VALIDITY_HOURS = 24;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol: rawSymbol } = await params;
  const symbol = rawSymbol.trim().toUpperCase();
  
  try {
    const { searchParams } = new URL(request.url);
    const timeframe = searchParams.get("timeframe") || "1D";
    const horizonParam = searchParams.get("horizon");
    const engineParam = (searchParams.get("engine") || "SWING") as "DAYTRADER" | "SWING" | "INVESTOR";
    
    // Validate engine
    if (!["DAYTRADER", "SWING", "INVESTOR"].includes(engineParam)) {
      return NextResponse.json(
        { error: "Invalid engine. Must be DAYTRADER, SWING, or INVESTOR." },
        { status: 400 }
      );
    }
    
    // Validate horizon
    const horizon = parseInt(horizonParam || "30", 10);
    if (![30, 60, 90].includes(horizon)) {
      return NextResponse.json(
        { error: "Invalid horizon. Must be 30, 60, or 90 days." },
        { status: 400 }
      );
    }

    // Compute date range for backtest and caching
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - horizon);
    // Normalize to YYYY-MM-DD for Edge Function and DB
    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];

    // Map UI timeframe (1D) to engine timeframe (1d)
    const engineTimeframe = timeframe === "1D" ? "1d" : timeframe.toLowerCase();

    // Validate symbol
    if (!symbol || symbol.length === 0 || symbol.length > 10) {
      return NextResponse.json(
        { error: "Invalid symbol" },
        { status: 400 }
      );
    }

    // Validate ticker is approved for AI backtesting
    const approvedTickers = await loadApprovedTickers();
    if (!approvedTickers.includes(symbol)) {
      return NextResponse.json(
        {
          error: "UNAPPROVED_TICKER",
          message: "This ticker is not approved for AI backtesting. Only validated tickers are supported.",
          requestAllowed: false,
        },
        { status: 400 }
      );
    }

    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Check PRO status (with dev mode override)
    let isPro = devForcePro(); // Dev mode override
    
    if (!isPro) {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("subscription_status")
        .eq("id", user.id)
        .single();

      isPro = profile?.subscription_status === "pro";
    }

    if (!isPro) {
      return NextResponse.json(
        { error: "Backtest feature requires PRO subscription" },
        { status: 403 }
      );
    }

    // Cache lookup is temporarily disabled after engine changes to ensure
    // users always see fresh results. To re-enable, wrap this block in a
    // feature flag and return cached results when desired.
    if (false) {
      const { data: cached } = await supabase
        .from("backtest_results")
        .select("*")
        .eq("engine_type", engineParam)
        .eq("symbol", symbol)
        .eq("timeframe", engineTimeframe)
        .eq("start_date", startDateStr)
        .eq("end_date", endDateStr)
        .maybeSingle();

      // If cached and fresh, return it
      if (cached) {
        const computedAt = new Date(cached.created_at);
        const ageHours = (Date.now() - computedAt.getTime()) / (1000 * 60 * 60);

        if (ageHours < CACHE_VALIDITY_HOURS) {
          console.log(`[backtest] Cache hit for ${symbol} (${engineParam}), age: ${ageHours.toFixed(1)}h`);
          return NextResponse.json({
            symbol: cached.symbol,
            timeframe, // keep UI timeframe
            horizonDays: horizon,
            engine: cached.engine_type,
            stats: {
              totalReturn: Number(cached.total_return_pct),
              maxDrawdown: Number(cached.max_drawdown_pct),
              winRate: Number(cached.win_rate_pct),
              totalTrades: cached.total_trades,
              avgR: Number(cached.avg_r_per_trade),
              tp1HitRate: Number(cached.tp1_hit_rate_pct),
              tp2HitRate: Number(cached.tp2_hit_rate_pct),
              bestTradeR: Number(cached.best_trade_r),
              worstTradeR: Number(cached.worst_trade_r),
            },
            equityCurve: (cached.equity_curve || []).map((point: any) => ({
              date: point.date,
              equity: point.equity,
            })),
            trades: (cached.trades || []).map((trade: any) => ({
              entryDate: trade.entry_date,
              exitDate: trade.exit_date,
              side: trade.side,
              entryPrice: trade.entry_price,
              exitPrice: trade.exit_price,
              shares: trade.shares,
              pnl: trade.pnl,
              pnlPct: trade.pnl_pct,
              r: trade.r,
              exitReason: trade.exit_reason,
            })),
            cached: true,
            computedAt: cached.created_at,
          });
        }
      }
    }

    // Call Edge Function to run backtest
    console.log(`[backtest] Running backtest for ${symbol} (${engineParam}), ${horizon} days`);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      console.error("[backtest] Missing Supabase env vars", {
        hasUrl: !!supabaseUrl,
        hasServiceRoleKey: !!serviceRoleKey,
      });
      return NextResponse.json(
        { error: "Backtest server configuration error (missing Supabase env vars)." },
        { status: 500 }
      );
    }

    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/run_backtest`;
    const edgeFunctionRes = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        engine_type: engineParam,
        symbol,
        timeframe: engineTimeframe,
        start_date: startDateStr,
        end_date: endDateStr,
      }),
    });

    if (!edgeFunctionRes.ok) {
      const errorText = await edgeFunctionRes.text();
      console.error(`[backtest] Edge Function failed:`, errorText);
      throw new Error(errorText || 'Edge Function call failed');
    }

    const edgeJson = await edgeFunctionRes.json();
    const result = edgeJson.result;

    // Transform Edge Function response to webapp format
    const transformedResult = {
      symbol,
      timeframe,
      horizonDays: horizon,
      engine: engineParam,
      stats: {
        totalReturn: result.total_return_pct,
        maxDrawdown: result.max_drawdown_pct,
        sharpeRatio: result.sharpe_ratio,
        winRate: result.win_rate_pct,
        totalTrades: result.total_trades,
        avgR: result.avg_r_per_trade,
        tp1HitRate: result.tp1_hit_rate_pct,
        tp2HitRate: result.tp2_hit_rate_pct,
        bestTradeR: result.best_trade_r,
        worstTradeR: result.worst_trade_r,
      },
      // Map engine equity_curve {date, equity} to UI format {t, equity}
      equityCurve: result.equity_curve?.map((point: any) => ({
        t: point.date,
        equity: point.equity,
      })) || [],
      // Map engine trades to BacktestTrade shape expected by UI
      trades: result.trades?.map((trade: any) => ({
        symbol,
        direction: trade.direction === 'long' ? 'LONG' : 'SHORT',
        entryPrice: trade.entry_price,
        exitPrice: trade.exit_price,
        exitReason:
          trade.exit_reason === 'sl'
            ? 'STOP_LOSS'
            : trade.exit_reason === 'tp1' || trade.exit_reason === 'tp2'
            ? 'TAKE_PROFIT'
            : 'END_OF_PERIOD',
        pnlPct: trade.pnl_pct,
        openedAt: trade.entry_date,
        closedAt: trade.exit_date,
        durationHours:
          trade.entry_date && trade.exit_date
            ? (new Date(trade.exit_date).getTime() - new Date(trade.entry_date).getTime()) /
              (1000 * 60 * 60)
            : null,
        confidenceScore: null,
        riskMode: 'medium',
      })) || [],
      cached: false,
      computedAt: new Date().toISOString(),
    };

    return NextResponse.json(transformedResult);

  } catch (error: any) {
    console.error("[backtest] Error:", error);
    
    // Handle specific error types
    const msg = error.message || "";
    if (msg.includes("Insufficient data") || msg.includes("No data found") || msg.includes("not enough data") || msg.includes("Insufficient OHLCV data")) {
      return NextResponse.json(
        { error: "Not enough historical data available for this symbol. Please try again later or choose a different symbol." },
        { status: 404 }
      );
    }

    if (msg.includes("Failed to fetch")) {
      return NextResponse.json(
        { error: "Unable to reach backtest engine. Please try again later." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error running backtest" },
      { status: 500 }
    );
  }
}
