/**
 * Daily Live Trading Report Edge Function
 * Runs Mon-Fri at 21:15 UTC (15 minutes after market close)
 * Reports today's live trading performance to Discord
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface DailyStats {
  total_trades: number;
  wins: number;
  losses: number;
  open_positions: number;
  win_rate: number;
  total_pnl: number;
  total_pnl_pct: number;
  drawdown_pct: number;
  best_trade: { ticker: string; pnl_pct: number } | null;
  worst_trade: { ticker: string; pnl_pct: number } | null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    console.log("Starting daily trading report...");

    // 1. Determine today's trading date key (UTC date; we rely on realized_pnl_date
    // to stay consistent with /api/performance/journal and /api/performance/summary).
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10); // YYYY-MM-DD

    console.log(`Fetching trades for realized_pnl_date = ${todayKey}`);

    // 2. Fetch today's closed trades for the unified LIVE SWING engine.
    // We filter by realized_pnl_date + engine_key to stay aligned with
    // journal/summary P&L calculations.
    const { data: todayTrades, error: tradesError } = await supabase
      .from("live_trades")
      .select("*")
      .eq("strategy", "SWING")
      .eq("engine_key", "SWING")
      .eq("realized_pnl_date", todayKey)
      .order("exit_timestamp", { ascending: false });

    if (tradesError) {
      console.error("Failed to fetch today's trades:", tradesError);
      throw new Error(`Database error: ${tradesError.message}`);
    }

    // 3. Fetch current open positions for the LIVE SWING engine only
    const { data: openPositions, error: positionsError } = await supabase
      .from("live_positions")
      .select("*")
      .eq("strategy", "SWING")
      .eq("engine_key", "SWING");

    if (positionsError) {
      console.error("Failed to fetch open positions:", positionsError);
    }

    // 4. Fetch equity curve-style snapshots for the unified SWING portfolio
    // We reuse the same logic as /api/performance/summary: a single $100k account
    // whose equity is derived from SWING trades.
    const startingEquity = 100000;

    // Fetch ALL closed trades for LIVE SWING engine to date, ordered ascending by exit time
    const { data: allSwingTrades, error: allTradesError } = await supabase
      .from("live_trades")
      .select("*")
      .eq("strategy", "SWING")
      .eq("engine_key", "SWING")
      .order("exit_timestamp", { ascending: true });

    if (allTradesError) {
      console.error("Failed to fetch all SWING trades for equity curve:", allTradesError);
      throw new Error(`Database error: ${allTradesError.message}`);
    }

    // Build equity curve (realized only) to compute max drawdown on the unified account
    const equitySnapshots: Array<{ timestamp: string; equity: number }> = [];
    let cumulativeRealizedPnl = 0;
    let peakEquity = startingEquity;
    let maxDrawdownPct = 0;

    if (allSwingTrades && allSwingTrades.length > 0) {
      const firstTradeDate = new Date(allSwingTrades[0].exit_timestamp || allSwingTrades[0].entry_timestamp);
      firstTradeDate.setHours(0, 0, 0, 0);
      equitySnapshots.push({
        timestamp: firstTradeDate.toISOString(),
        equity: startingEquity,
      });

      for (const trade of allSwingTrades) {
        const ts = trade.exit_timestamp || trade.entry_timestamp;
        if (!ts) continue;
        cumulativeRealizedPnl += trade.realized_pnl_dollars || 0;
        const equity = startingEquity + cumulativeRealizedPnl;
        equitySnapshots.push({ timestamp: ts, equity });

        if (equity > peakEquity) peakEquity = equity;
        const dd = ((peakEquity - equity) / peakEquity) * 100;
        if (dd > maxDrawdownPct) maxDrawdownPct = dd;
      }
    }

    // 5. Calculate statistics
    const stats = calculateDailyStats(
      todayTrades || [],
      openPositions || [],
      equitySnapshots,
      startingEquity,
      maxDrawdownPct
    );

    // 6. Post to Discord
    await postDailyReport(stats, now);

    // 7. Send push notifications to all PRO users
    await sendPushNotifications(stats);

    console.log("Daily trading report completed successfully");

    return new Response(
      JSON.stringify({
        success: true,
        date: now.toISOString(),
        stats,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Daily report error:", err);

    // Try to post error to Discord
    try {
      await postErrorToDiscord(String(err));
    } catch (discordErr) {
      console.error("Failed to post error to Discord:", discordErr);
    }

    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

function calculateDailyStats(
  trades: any[],
  openPositions: any[],
  equitySnapshots: Array<{ timestamp: string; equity: number }>,
  startingEquity: number,
  precomputedMaxDrawdown: number
): DailyStats {
  const totalTrades = trades.length;
  const wins = trades.filter(t => 
    t.exit_reason === 'TP_HIT' || t.realized_pnl_dollars > 0
  ).length;
  const losses = trades.filter(t => 
    t.exit_reason === 'SL_HIT' || t.realized_pnl_dollars < 0
  ).length;

  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;

  // Calculate total P&L in dollars and percentage **for today only**
  const totalPnlDollars = trades.reduce((sum, t) => sum + (t.realized_pnl_dollars || 0), 0);

  // Unified live account equity curve is derived from all SWING trades.
  // We receive:
  // - equitySnapshots: realized-equity snapshots from $100k baseline
  // - startingEquity: fixed 100k
  // - precomputedMaxDrawdown: max DD over full history of this account
  // To match /api/performance/summary, "Total Return" should include **realized + unrealized** P&L.
  const realizedAllTime = equitySnapshots.length > 0
    ? equitySnapshots[equitySnapshots.length - 1].equity - startingEquity
    : 0;

  const unrealizedFromOpen = openPositions.reduce(
    (sum, p) => sum + (p.unrealized_pnl_dollars || 0),
    0,
  );

  const latestEquity = startingEquity + realizedAllTime + unrealizedFromOpen;
  const totalPnlPct = ((latestEquity - startingEquity) / startingEquity) * 100;

  const maxDrawdown = precomputedMaxDrawdown;

  // Find best and worst trades
  let bestTrade = null;
  let worstTrade = null;
  
  if (trades.length > 0) {
    const sortedTrades = [...trades].sort((a, b) => 
      (b.realized_pnl_dollars || 0) - (a.realized_pnl_dollars || 0)
    );
    
    const best = sortedTrades[0];
    const worst = sortedTrades[sortedTrades.length - 1];
    
    if (best) {
      const bestPnlPct = ((best.exit_price - best.entry_price) / best.entry_price) * 100 *
                         (best.side === 'SHORT' ? -1 : 1);
      bestTrade = { ticker: best.ticker, pnl_pct: bestPnlPct };
    }
    
    if (worst) {
      const worstPnlPct = ((worst.exit_price - worst.entry_price) / worst.entry_price) * 100 *
                          (worst.side === 'SHORT' ? -1 : 1);
      worstTrade = { ticker: worst.ticker, pnl_pct: worstPnlPct };
    }
  }

  return {
    total_trades: totalTrades,
    wins,
    losses,
    open_positions: openPositions.length,
    win_rate: winRate,
    total_pnl: totalPnlDollars,
    total_pnl_pct: totalPnlPct,
    drawdown_pct: maxDrawdown,
    best_trade: bestTrade,
    worst_trade: worstTrade,
  };
}

async function postDailyReport(stats: DailyStats, date: Date) {
  const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
  
  if (!webhookUrl) {
    console.warn("DISCORD_WEBHOOK_URL not set, skipping Discord post");
    return;
  }

  const dateStr = date.toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  const pnlEmoji = stats.total_pnl >= 0 ? '📈' : '📉';
  const pnlColor = stats.total_pnl >= 0 ? 0x00ff00 : 0xff0000;

  // Optional: enrich with brakes state for live SWING and SHADOW_BRAKES_V1
  let brakesLine = '';
  try {
    // Discover current PRIMARY SWING engine version so the report stays correct
    let liveEngineVersion = 'SWING_V1_EXPANSION';
    const { data: liveEngine, error: liveEngineError } = await supabase
      .from('engine_versions')
      .select('engine_version')
      .eq('engine_key', 'SWING')
      .eq('run_mode', 'PRIMARY')
      .eq('is_enabled', true)
      .is('stopped_at', null)
      .order('created_at', { ascending: false })
      .maybeSingle();

    if (!liveEngineError && liveEngine?.engine_version) {
      liveEngineVersion = liveEngine.engine_version as string;
    }

    // Live SWING PRIMARY brakes state
    const { data: liveState, error: liveStateError } = await supabase
      .from('engine_daily_state')
      .select('state,daily_pnl,trades_count,throttle_factor,halt_reason,updated_at,trading_day')
      .eq('engine_key', 'SWING')
      .eq('engine_version', liveEngineVersion)
      .order('trading_day', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (liveStateError) {
      console.warn('[daily_report] Failed to load live brakes state:', liveStateError.message ?? liveStateError);
    }

    // Shadow brakes engine state
    const { data: shadowState, error: shadowStateError } = await supabase
      .from('engine_daily_state')
      .select('state,daily_pnl,trades_count,throttle_factor,halt_reason,updated_at,trading_day')
      .eq('engine_key', 'SWING')
      .eq('engine_version', 'SHADOW_BRAKES_V1')
      .order('trading_day', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (shadowStateError) {
      console.warn('[daily_report] Failed to load shadow brakes state:', shadowStateError.message ?? shadowStateError);
    }

    const parts: string[] = [];
    if (liveState) {
      const liveStateLabel = String((liveState as any).state || 'NORMAL');
      const livePnl = Number((liveState as any).daily_pnl ?? 0).toFixed(0);
      const liveTrades = Number((liveState as any).trades_count ?? 0);
      const tf = Number((liveState as any).throttle_factor ?? 1);
      const tfLabel = tf < 1 ? `${(tf * 100).toFixed(0)}% size` : '100% size';
      parts.push(`Live SWING (${liveEngineVersion}): **${liveStateLabel}** | PnL $${livePnl} | trades ${liveTrades} | ${tfLabel}`);
    }
    if (shadowState) {
      const shStateLabel = String((shadowState as any).state || 'NORMAL');
      const shPnl = Number((shadowState as any).daily_pnl ?? 0).toFixed(0);
      const shTrades = Number((shadowState as any).trades_count ?? 0);
      const shCap = 25; // from SHADOW_BRAKES_V1 config
      const shReason = (shadowState as any).halt_reason ? ` (${(shadowState as any).halt_reason})` : '';
      parts.push(`Shadow Brakes: **${shStateLabel}**${shReason} | PnL $${shPnl} | trades ${shTrades}/${shCap}`);
    }

    if (parts.length > 0) {
      brakesLine = parts.join('\\n');
    }
  } catch (e) {
    console.warn('[daily_report] Failed to load brakes state for Discord report:', (e as any)?.message ?? e);
  }

  const fields: any[] = [
    {
      name: "📊 Today's Activity",
      value: `**Trades:** ${stats.total_trades}\n**Wins:** ${stats.wins} | **Losses:** ${stats.losses}\n**Open Positions:** ${stats.open_positions}`,
      inline: false,
    },
    {
      name: "💰 Performance",
      value: `**Win Rate:** ${stats.win_rate.toFixed(1)}%\n**Daily P&L:** ${stats.total_pnl >= 0 ? '+' : ''}$${stats.total_pnl.toFixed(2)}\n**Total Return:** ${stats.total_pnl_pct >= 0 ? '+' : ''}${stats.total_pnl_pct.toFixed(2)}%`,
      inline: true,
    },
    {
      name: "📉 Risk Metrics",
      value: `**Max Drawdown:** ${stats.drawdown_pct.toFixed(2)}%`,
      inline: true,
    },
  ];

  if (brakesLine) {
    fields.push({
      name: "🛑 Brakes State",
      value: brakesLine,
      inline: false,
    });
  }

  const embed = {
    title: `${pnlEmoji} Daily Trading Report - ${dateStr}`,
    color: pnlColor,
    fields,
    footer: {
      text: "Marild AI • Live Trading • Not financial advice",
    },
    timestamp: date.toISOString(),
  };

  // Add best/worst trades if available
  if (stats.best_trade || stats.worst_trade) {
    let tradesText = '';
    if (stats.best_trade) {
      tradesText += `🏆 **Best:** ${stats.best_trade.ticker} (${stats.best_trade.pnl_pct >= 0 ? '+' : ''}${stats.best_trade.pnl_pct.toFixed(2)}%)\n`;
    }
    if (stats.worst_trade) {
      tradesText += `📉 **Worst:** ${stats.worst_trade.ticker} (${stats.worst_trade.pnl_pct.toFixed(2)}%)`;
    }
    
    embed.fields.push({
      name: "🎯 Notable Trades",
      value: tradesText,
      inline: false,
    });
  }

  const payload = {
    embeds: [embed],
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Discord webhook failed: ${response.status}`);
  }

  console.log("Successfully posted daily report to Discord");
}

async function sendPushNotifications(stats: DailyStats) {
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
    const pnlEmoji = stats.total_pnl >= 0 ? '📈' : '📉';
    const pnlSign = stats.total_pnl >= 0 ? '+' : '';
    const title = `${pnlEmoji} Daily Trading Report`;
    const body = `${stats.total_trades} trades • ${stats.wins}W-${stats.losses}L • ${pnlSign}$${stats.total_pnl.toFixed(0)} (${pnlSign}${stats.total_pnl_pct.toFixed(2)}%)`;

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
          total_trades: stats.total_trades,
          win_rate: stats.win_rate,
          total_pnl: stats.total_pnl,
        },
      }),
    });

    if (response.ok) {
      console.log(`Push notifications sent to ${userIds.length} PRO users`);
    } else {
      console.error(`Failed to send push notifications: ${response.status}`);
    }
  } catch (err) {
    console.error("Error sending push notifications:", err);
    // Don't throw - notification failure shouldn't fail the report
  }
}

async function postErrorToDiscord(error: string) {
  const webhookUrl = Deno.env.get("DISCORD_WEBHOOK_URL");
  
  if (!webhookUrl) return;

  const payload = {
    embeds: [{
      title: "❌ Daily Trading Report Error",
      description: `Failed to generate daily report:\n\`\`\`${error}\`\`\``,
      color: 0xff0000,
      timestamp: new Date().toISOString(),
    }],
  };

  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
