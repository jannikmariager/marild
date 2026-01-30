/**
 * Monthly Signal Evaluation Edge Function
 * Runs on the last day of every month at 22:10 CET to evaluate all signals from the month
 * Calculates comprehensive performance stats, best/worst performers, BUY/SELL distribution
 * Posts detailed monthly report to Discord
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import type { Signal } from "../_admin_shared/signal_evaluator.ts";
import {
  calculatePerformanceStats,
  findBestPerformer,
  findWorstPerformer,
  countSignalsByDirection,
  getMonthName,
} from "../_admin_shared/signal_evaluator.ts";
import {
  postMonthlyResults,
  postMonthlyEvaluationError,
  type MonthlySummary,
} from "../_admin_shared/discord_monthly_poster.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/**
 * Main monthly evaluation handler
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    console.log("Starting monthly signal evaluation...");

    // 1. Calculate date range for the current month
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    monthEnd.setHours(23, 59, 59, 999);

    const monthName = getMonthName(now);
    console.log(`Evaluating signals from ${monthStart.toISOString()} to ${monthEnd.toISOString()}`);

    // 2. Fetch all evaluated signals from the current month
    const { data: signals, error: fetchError } = await supabase
      .from("signals")
      .select("*")
      .gte("created_at", monthStart.toISOString())
      .lte("created_at", monthEnd.toISOString())
      .not("evaluated_at", "is", null); // Only include evaluated signals

    if (fetchError) {
      console.error("Failed to fetch signals:", fetchError);
      await postMonthlyEvaluationError(`Database error: ${fetchError.message}`);
      return new Response(
        JSON.stringify({ error: "Failed to fetch signals" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!signals || signals.length === 0) {
      console.log("No signals to report for this month");

      // Still post a report showing 0 signals
      const summary: MonthlySummary = {
        month_name: monthName,
        signals: [],
        stats: {
          total_signals: 0,
          wins: 0,
          losses: 0,
          open_trades: 0,
          win_rate: 0,
          total_pl: 0,
          average_pl: 0,
        },
        best_performer: null,
        worst_performer: null,
        buy_count: 0,
        sell_count: 0,
      };

      await postMonthlyResults(summary);

      return new Response(
        JSON.stringify({ message: "No signals to report this month", count: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${signals.length} evaluated signals for the month`);

    // 3. Calculate performance statistics
    const stats = calculatePerformanceStats(signals as Signal[]);
    const best_performer = findBestPerformer(signals as Signal[]);
    const worst_performer = findWorstPerformer(signals as Signal[]);
    const { buy, sell } = countSignalsByDirection(signals as Signal[]);

    // 4. Build monthly summary
    const summary: MonthlySummary = {
      month_name: monthName,
      signals: signals as Signal[],
      stats,
      best_performer,
      worst_performer,
      buy_count: buy,
      sell_count: sell,
    };

    // 5. Post monthly results to Discord
    await postMonthlyResults(summary);

    console.log("Monthly evaluation completed successfully");

    return new Response(
      JSON.stringify({
        success: true,
        month: monthName,
        signals_evaluated: signals.length,
        summary: {
          wins: stats.wins,
          losses: stats.losses,
          open_trades: stats.open_trades,
          win_rate: stats.win_rate.toFixed(2) + "%",
          total_pl: stats.total_pl.toFixed(2) + "%",
          average_pl: stats.average_pl.toFixed(2) + "%",
          best_performer: best_performer
            ? `${best_performer.ticker} (+${best_performer.pl_percentage.toFixed(2)}%)`
            : "N/A",
          worst_performer: worst_performer
            ? `${worst_performer.ticker} (${worst_performer.pl_percentage.toFixed(2)}%)`
            : "N/A",
          buy_signals: buy,
          sell_signals: sell,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Monthly evaluation error:", err);
    await postMonthlyEvaluationError(String(err));

    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
