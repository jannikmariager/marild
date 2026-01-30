/**
 * Weekly Live Trading Report Edge Function
 * Runs every Friday at 22:00 UTC (after market close) to report all live trades from the past week
 * Calculates performance stats, finds best/worst performers, and posts report to Discord
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import type { Signal } from "../_admin_shared/signal_evaluator.ts";
import {
  calculatePerformanceStats,
  findBestPerformer,
  findWorstPerformer,
  getWeekNumber,
} from "../_admin_shared/signal_evaluator.ts";
import {
  postWeeklyResults,
  postWeeklyEvaluationError,
  type WeeklySummary,
} from "../_admin_shared/discord_weekly_poster.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/**
 * Main weekly evaluation handler
 */
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    console.log("Starting weekly live trading report...");

    // 1. Calculate date range for the past week
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - 7);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(now);
    weekEnd.setHours(23, 59, 59, 999);

    console.log(`Fetching live trades from ${weekStart.toISOString()} to ${weekEnd.toISOString()}`);

    // 2. Fetch all live trades from the past week (closed trades only)
    const { data: trades, error: fetchError } = await supabase
      .from("live_trades")
      .select("*")
      .gte("exit_timestamp", weekStart.toISOString())
      .lte("exit_timestamp", weekEnd.toISOString())
      .order("exit_timestamp", { ascending: false });

    if (fetchError) {
      console.error("Failed to fetch live trades:", fetchError);
      await postWeeklyEvaluationError(`Database error: ${fetchError.message}`);
      return new Response(
        JSON.stringify({ error: "Failed to fetch live trades" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!trades || trades.length === 0) {
      console.log("No live trades to report for this week");
      
      // Still post a report showing 0 signals
      const { week, year } = getWeekNumber(now);
      const summary: WeeklySummary = {
        week_number: week,
        year,
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
      };

      await postWeeklyResults(summary);

      return new Response(
        JSON.stringify({ message: "No live trades to report this week", count: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`Found ${trades.length} live trades for the week`);

    // 3. Convert live trades to Signal format for compatibility with existing stats functions
    const formattedTrades: Signal[] = trades.map((trade: any) => ({
      id: trade.id,
      ticker: trade.ticker,
      created_at: trade.entry_timestamp,
      evaluated_at: trade.exit_timestamp,
      entry_price: trade.entry_price,
      exit_price: trade.exit_price,
      result: trade.exit_reason === 'TP_HIT' || trade.exit_reason === 'TRAILING_SL_HIT' ? 'WIN' : 
              trade.exit_reason === 'SL_HIT' ? 'LOSS' : 'CLOSED',
      pl_percentage: ((trade.exit_price - trade.entry_price) / trade.entry_price) * 100 * 
                     (trade.side === 'SHORT' ? -1 : 1),
      side: trade.side || 'LONG',
      strategy: trade.strategy,
    }));

    // 4. Calculate performance statistics
    const stats = calculatePerformanceStats(formattedTrades);
    const best_performer = findBestPerformer(formattedTrades);
    const worst_performer = findWorstPerformer(formattedTrades);

    // 5. Build weekly summary
    const { week, year } = getWeekNumber(now);
    const summary: WeeklySummary = {
      week_number: week,
      year,
      signals: formattedTrades,
      stats,
      best_performer,
      worst_performer,
    };

    // 6. Post weekly results to Discord
    await postWeeklyResults(summary);

    // 7. Send push notifications to all PRO users
    await sendWeeklyPushNotifications(summary);

    console.log("Weekly live trading report completed successfully");

    return new Response(
      JSON.stringify({
        success: true,
        week: week,
        year: year,
        trades_reported: trades.length,
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
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Weekly evaluation error:", err);
    await postWeeklyEvaluationError(String(err));

    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

async function sendWeeklyPushNotifications(summary: WeeklySummary) {
  try {
    // Get all PRO users
    const { data: proUsers, error } = await supabase
      .from("user_subscriptions")
      .select("user_id")
      .eq("status", "active");

    if (error || !proUsers || proUsers.length === 0) {
      console.log("No PRO users found for push notifications");
      return;
    }

    const userIds = proUsers.map(u => u.user_id);

    // Format notification message
    const pnlEmoji = summary.stats.total_pl >= 0 ? '👍' : '👎';
    const pnlSign = summary.stats.total_pl >= 0 ? '+' : '';
    const title = `📅 Weekly Trading Report - Week ${summary.week_number}`;
    const body = `${summary.stats.total_signals} trades • ${summary.stats.wins}W-${summary.stats.losses}L • ${pnlSign}${summary.stats.total_pl.toFixed(2)}% P&L ${pnlEmoji}`;

    // Call push notification function
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    const response = await fetch(`${supabaseUrl}/functions/v1/admin_send_push`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        body,
        type: "trade",
        user_ids: userIds,
        data: {
          screen: "performance",
          week: summary.week_number,
          year: summary.year,
          total_signals: summary.stats.total_signals,
          win_rate: summary.stats.win_rate,
          total_pl: summary.stats.total_pl,
        },
      }),
    });

    if (response.ok) {
      console.log(`Weekly push notifications sent to ${userIds.length} PRO users`);
    } else {
      console.error(`Failed to send weekly push notifications: ${response.status}`);
    }
  } catch (err) {
    console.error("Error sending weekly push notifications:", err);
    // Don't throw - notification failure shouldn't fail the report
  }
}
