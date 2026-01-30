/**
 * Daily Signal Evaluation Edge Function
 * Runs at 22:00 CET (21:00 CET after DST) to evaluate all signals from today
 * Calculates P/L, determines winners/losers, and posts report to Discord
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { fetchClosingPricesBatch, type PriceData } from "../_admin_shared/market_data_client.ts";
import {
  postDailyResults,
  postEvaluationError,
  type SignalResult,
  type DailySummary,
} from "../_admin_shared/discord_results_poster.ts";
import { postPublicDailyReport } from "../_admin_shared/discord_public_formatter.ts";
import { postPremiumDailyReport } from "../_admin_shared/discord_premium_formatter.ts";
import {
  generateEquityCurveChart,
  getCumulativePL,
  saveEquityCurveSnapshot,
} from "../_admin_shared/equity_curve_chart.ts";
import { calculatePerformanceStats } from "../_admin_shared/signal_evaluator.ts";
import { postEvaluationError as postAdminError } from "../_admin_shared/admin_alerts.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface Signal {
  id: string;
  ticker: string;
  direction: "BUY" | "SELL";
  entry_price: number;
  tp1: number;
  tp2: number | null;
  sl: number;
  confidence: number;
  timeframe: string;
  created_at: string;
}

/**
 * Evaluate a single signal against closing price
 */
function evaluateSignal(signal: Signal, closePrice: number): {
  result: "TP1" | "TP2" | "SL" | "OPEN";
  pl_percentage: number;
} {
  const { direction, entry_price, tp1, tp2, sl } = signal;

  let result: "TP1" | "TP2" | "SL" | "OPEN";
  let pl_percentage: number;

  if (direction === "BUY") {
    // BUY signal evaluation
    if (closePrice <= sl) {
      result = "SL";
    } else if (tp2 && closePrice >= tp2) {
      result = "TP2";
    } else if (closePrice >= tp1) {
      result = "TP1";
    } else {
      result = "OPEN";
    }

    // Calculate P/L for BUY: ((close - entry) / entry) * 100
    pl_percentage = ((closePrice - entry_price) / entry_price) * 100;
  } else {
    // SELL signal evaluation
    if (closePrice >= sl) {
      result = "SL";
    } else if (tp2 && closePrice <= tp2) {
      result = "TP2";
    } else if (closePrice <= tp1) {
      result = "TP1";
    } else {
      result = "OPEN";
    }

    // Calculate P/L for SELL: ((entry - close) / entry) * 100
    pl_percentage = ((entry_price - closePrice) / entry_price) * 100;
  }

  return { result, pl_percentage };
}

/**
 * Main evaluation handler
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    console.log("Starting daily signal evaluation...");

    // 1. Fetch all signals from today that haven't been evaluated
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: signals, error: fetchError } = await supabase
      .from("signals")
      .select("*")
      .gte("created_at", today.toISOString())
      .is("evaluated_at", null);

    if (fetchError) {
      console.error("Failed to fetch signals:", fetchError);
      await postEvaluationError(`Database error: ${fetchError.message}`);
      return new Response(
        JSON.stringify({ error: "Failed to fetch signals" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!signals || signals.length === 0) {
      console.log("No signals to evaluate today");
      return new Response(
        JSON.stringify({ message: "No signals to evaluate", count: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${signals.length} signals to evaluate`);

    // 2. Extract unique tickers
    const tickers = [...new Set(signals.map((s: Signal) => s.ticker))];
    console.log(`Fetching closing prices for ${tickers.length} tickers`);

    // 3. Fetch closing prices for all tickers
    const priceMap = await fetchClosingPricesBatch(tickers);

    if (priceMap.size === 0) {
      await postEvaluationError("Failed to fetch any closing prices from market data providers");
      return new Response(
        JSON.stringify({ error: "No price data available" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully fetched ${priceMap.size} prices`);

    // 4. Evaluate each signal
    const results: SignalResult[] = [];
    const updates = [];

    for (const signal of signals as Signal[]) {
      const priceData = priceMap.get(signal.ticker);
      
      if (!priceData) {
        console.warn(`No price data for ${signal.ticker}, skipping`);
        continue;
      }

      const { result, pl_percentage } = evaluateSignal(signal, priceData.price);

      results.push({
        ticker: signal.ticker,
        direction: signal.direction,
        entry_price: signal.entry_price,
        close_price: priceData.price,
        result,
        pl_percentage,
        confidence: signal.confidence,
        timeframe: signal.timeframe,
      });

      // Update database with evaluation results
      updates.push(
        supabase
          .from("signals")
          .update({
            evaluated_at: new Date().toISOString(),
            close_price: priceData.price,
            result,
            pl_percentage,
          })
          .eq("id", signal.id)
      );
    }

    // 5. Execute all database updates
    await Promise.all(updates);
    console.log(`Updated ${updates.length} signals in database`);

    // 6. Calculate summary statistics
    const wins = results.filter((r) => r.result === "TP1" || r.result === "TP2").length;
    const losses = results.filter((r) => r.result === "SL").length;
    const open_trades = results.filter((r) => r.result === "OPEN").length;
    const win_rate = wins + losses > 0 ? (wins / (wins + losses)) * 100 : 0;
    const total_pl = results.reduce((sum, r) => sum + r.pl_percentage, 0);

    const summary: DailySummary = {
      date: new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      signals: results,
      wins,
      losses,
      open_trades,
      win_rate,
      total_pl,
    };

    // 7. Get cumulative P/L and generate chart
    const cumulativePL = await getCumulativePL(supabase);
    const newCumulative = cumulativePL + total_pl;
    const chartUrl = await generateEquityCurveChart(supabase);

    // 8. Save equity curve snapshot
    await saveEquityCurveSnapshot(supabase, {
      as_of_date: new Date(),
      cumulative_pl_percent: newCumulative,
      daily_pl_percent: total_pl,
      total_signals: results.length,
      winning_signals: wins,
      losing_signals: losses,
      win_rate,
    });

    // 9. Calculate stats for formatters
    const stats = {
      total_signals: results.length,
      wins,
      losses,
      open_trades,
      win_rate,
      total_pl,
      average_pl: results.length > 0 ? total_pl / results.length : 0,
    };

    const dateLabel = new Date().toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    // 10. Post to PUBLIC channel (no sensitive data)
    await postPublicDailyReport({
      period_label: "Daily",
      date_label: dateLabel,
      stats,
      cumulative_pl: newCumulative,
      chart_url: chartUrl || undefined,
    });

    // 11. Post to PREMIUM channel (full details)
    await postPremiumDailyReport({
      period_label: "Daily",
      date_label: dateLabel,
      signals: signals.map((s: any, i: number) => ({
        ...s,
        close_price: results[i]?.close_price,
        result: results[i]?.result,
        pl_percentage: results[i]?.pl_percentage,
      })),
      stats,
      cumulative_pl: newCumulative,
      chart_url: chartUrl || undefined,
    });

    // 12. Also post to legacy results channel
    await postDailyResults(summary);

    console.log("Daily evaluation completed successfully");

    return new Response(
      JSON.stringify({
        success: true,
        evaluated: results.length,
        summary: {
          wins,
          losses,
          open_trades,
          win_rate: win_rate.toFixed(2) + "%",
          total_pl: total_pl.toFixed(2) + "%",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Signal evaluation error:", err);
    await postEvaluationError(String(err));

    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
