/**
 * Premium Discord Performance Formatter
 * 
 * This formatter is for PREMIUM channels ONLY
 * Shows FULL details:
 * - Tickers
 * - Entry/Close prices
 * - TP1/TP2/SL outcomes
 * - SMC data (Order Blocks, FVG, Liquidity)
 * - Confidence scores
 * - Individual P/L per signal
 * - Complete reasoning
 */

import type { Signal, PerformanceStats } from "./signal_evaluator.ts";

// Discord webhook helper
interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
  image?: { url: string };
}

async function sendWebhook(url: string, embeds: DiscordEmbed[]) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds }),
  });
  if (!response.ok) {
    throw new Error(`Webhook failed: ${response.status}`);
  }
}

export interface PremiumPerformanceSummary {
  period_label: string;
  date_label: string;
  signals: Signal[];
  stats: PerformanceStats;
  cumulative_pl: number;
  chart_url?: string;
}

/**
 * Format individual signal for premium display
 */
function formatSignalDetail(signal: Signal): string {
  const emoji = signal.direction === "BUY" ? "🟢" : "🔻";
  const resultEmoji = {
    TP1: "🎯",
    TP2: "🎯🎯",
    SL: "❌",
    OPEN: "⏳",
  }[signal.result || "OPEN"];

  const plSign = (signal.pl_percentage || 0) >= 0 ? "+" : "";
  
  let details = `${emoji} **${signal.direction} – ${signal.ticker}**\n`;
  details += `Entry: $${signal.entry_price.toFixed(2)}\n`;
  
  if (signal.close_price) {
    details += `Close: $${signal.close_price.toFixed(2)}\n`;
  }
  
  details += `Result: ${resultEmoji} ${signal.result || "OPEN"}\n`;
  
  if (signal.pl_percentage !== null && signal.pl_percentage !== undefined) {
    details += `P/L: **${plSign}${signal.pl_percentage.toFixed(2)}%**\n`;
  }
  
  // Add SMC data if available
  if (signal.smc_data) {
    const smc = signal.smc_data as any;
    let smcLine = "SMC: ";
    
    if (smc.orderBlocks && smc.orderBlocks.length > 0) {
      const ob = smc.orderBlocks[0];
      smcLine += `OB ${ob.price || ob.priceHigh || "N/A"}`;
    }
    
    if (smc.fairValueGaps && smc.fairValueGaps.length > 0) {
      const fvg = smc.fairValueGaps[0];
      smcLine += ` | FVG ${fvg.top || "N/A"}-${fvg.bottom || "N/A"}`;
    }
    
    if (smc.liquidityZones && smc.liquidityZones.length > 0) {
      const liq = smc.liquidityZones[0];
      smcLine += ` | LIQ ${liq.price || "N/A"}`;
    }
    
    if (smcLine !== "SMC: ") {
      details += `${smcLine}\n`;
    }
  }
  
  if (signal.confidence) {
    details += `Confidence: ${signal.confidence}%\n`;
  }
  
  if (signal.timeframe) {
    details += `Timeframe: ${signal.timeframe}\n`;
  }
  
  return details;
}

/**
 * Post premium daily performance report
 */
export async function postPremiumDailyReport(
  summary: PremiumPerformanceSummary
): Promise<boolean> {
  const webhookUrl = Deno.env.get("DISCORD_PREMIUM_PERFORMANCE_WEBHOOK_URL");
  
  if (!webhookUrl) {
    console.warn("DISCORD_PREMIUM_PERFORMANCE_WEBHOOK_URL not configured");
    return false;
  }

  // Build signal details (max 10 signals per embed to avoid length limits)
  const signalFields: Array<{ name: string; value: string; inline: boolean }> = [];
  
  for (const signal of summary.signals.slice(0, 10)) {
    signalFields.push({
      name: `${signal.ticker} – ${signal.direction}`,
      value: formatSignalDetail(signal),
      inline: false,
    });
  }

  // Build summary
  const summaryText = `
**Signals:** ${summary.stats.total_signals}
**Wins:** ${summary.stats.wins}
**Losses:** ${summary.stats.losses}
**Open Trades:** ${summary.stats.open_trades}
**Win Rate:** ${summary.stats.win_rate.toFixed(0)}%
**Daily Return:** ${summary.stats.total_pl >= 0 ? "+" : ""}${summary.stats.total_pl.toFixed(2)}%
**Cumulative Return:** ${summary.cumulative_pl >= 0 ? "+" : ""}${summary.cumulative_pl.toFixed(2)}%
  `.trim();

  // Determine color
  let embedColor = 0x808080;
  if (summary.stats.total_pl > 5) {
    embedColor = 0x00ff00;
  } else if (summary.stats.total_pl > 0) {
    embedColor = 0x90ee90;
  } else if (summary.stats.total_pl < -5) {
    embedColor = 0xff0000;
  } else if (summary.stats.total_pl < 0) {
    embedColor = 0xffa07a;
  }

  const embed: DiscordEmbed = {
    title: `💎 Premium Daily Performance (${summary.date_label})`,
    description: summary.signals.length === 0
      ? "No signals generated today."
      : "Full breakdown of all signals with complete details:",
    color: embedColor,
    fields: [
      ...signalFields,
      {
        name: "━━━━━━━━━━━━━━━━━━━━",
        value: "**Summary**",
        inline: false,
      },
      {
        name: "Performance",
        value: summaryText,
        inline: false,
      },
    ],
    footer: {
      text: "TradeLens AI Premium • Not financial advice",
    },
    timestamp: new Date().toISOString(),
  };

  if (summary.chart_url) {
    embed.image = { url: summary.chart_url };
  }

  try {
    await sendWebhook(webhookUrl, [embed]);
    console.log(`Posted premium daily report for ${summary.date_label}`);
    return true;
  } catch (error) {
    console.error("Failed to post premium daily report:", error);
    return false;
  }
}

/**
 * Post premium weekly performance report
 */
export async function postPremiumWeeklyReport(
  summary: PremiumPerformanceSummary
): Promise<boolean> {
  const webhookUrl = Deno.env.get("DISCORD_PREMIUM_PERFORMANCE_WEBHOOK_URL");
  
  if (!webhookUrl) {
    console.warn("DISCORD_PREMIUM_PERFORMANCE_WEBHOOK_URL not configured");
    return false;
  }

  // Find best and worst performers
  let bestPerformer: Signal | null = null;
  let worstPerformer: Signal | null = null;
  
  for (const signal of summary.signals) {
    if (signal.pl_percentage !== null && signal.pl_percentage !== undefined) {
      if (!bestPerformer || signal.pl_percentage > (bestPerformer.pl_percentage || 0)) {
        bestPerformer = signal;
      }
      if (!worstPerformer || signal.pl_percentage < (worstPerformer.pl_percentage || 0)) {
        worstPerformer = signal;
      }
    }
  }

  let performanceText = "";
  
  if (bestPerformer) {
    performanceText += `🏆 **Best:** ${bestPerformer.ticker} (${bestPerformer.pl_percentage! >= 0 ? "+" : ""}${bestPerformer.pl_percentage!.toFixed(2)}%)\n`;
  }
  
  if (worstPerformer) {
    performanceText += `💀 **Worst:** ${worstPerformer.ticker} (${worstPerformer.pl_percentage! >= 0 ? "+" : ""}${worstPerformer.pl_percentage!.toFixed(2)}%)\n`;
  }

  performanceText += `\n**Signals:** ${summary.stats.total_signals}\n`;
  performanceText += `**Wins:** ${summary.stats.wins}\n`;
  performanceText += `**Losses:** ${summary.stats.losses}\n`;
  performanceText += `**Win Rate:** ${summary.stats.win_rate.toFixed(0)}%\n`;
  performanceText += `**Weekly Return:** ${summary.stats.total_pl >= 0 ? "+" : ""}${summary.stats.total_pl.toFixed(2)}%\n`;
  performanceText += `**Avg per Signal:** ${summary.stats.average_pl >= 0 ? "+" : ""}${summary.stats.average_pl.toFixed(2)}%\n\n`;
  performanceText += `📈 **Cumulative Return:** ${summary.cumulative_pl >= 0 ? "+" : ""}${summary.cumulative_pl.toFixed(2)}%`;

  let embedColor = 0x808080;
  if (summary.stats.total_pl > 10) {
    embedColor = 0x00ff00;
  } else if (summary.stats.total_pl > 0) {
    embedColor = 0x90ee90;
  } else if (summary.stats.total_pl < -10) {
    embedColor = 0xff0000;
  } else if (summary.stats.total_pl < 0) {
    embedColor = 0xffa07a;
  }

  const embed: DiscordEmbed = {
    title: `💎 Premium Weekly Performance (${summary.date_label})`,
    description: performanceText,
    color: embedColor,
    footer: {
      text: "TradeLens AI Premium • Not financial advice",
    },
    timestamp: new Date().toISOString(),
  };

  if (summary.chart_url) {
    embed.image = { url: summary.chart_url };
  }

  try {
    await sendWebhook(webhookUrl, [embed]);
    console.log(`Posted premium weekly report for ${summary.date_label}`);
    return true;
  } catch (error) {
    console.error("Failed to post premium weekly report:", error);
    return false;
  }
}

/**
 * Post premium monthly performance report
 */
export async function postPremiumMonthlyReport(
  summary: PremiumPerformanceSummary
): Promise<boolean> {
  const webhookUrl = Deno.env.get("DISCORD_PREMIUM_PERFORMANCE_WEBHOOK_URL");
  
  if (!webhookUrl) {
    console.warn("DISCORD_PREMIUM_PERFORMANCE_WEBHOOK_URL not configured");
    return false;
  }

  // Calculate best/worst and BUY/SELL distribution
  let bestPerformer: Signal | null = null;
  let worstPerformer: Signal | null = null;
  let buyCount = 0;
  let sellCount = 0;
  
  for (const signal of summary.signals) {
    if (signal.direction === "BUY") buyCount++;
    if (signal.direction === "SELL") sellCount++;
    
    if (signal.pl_percentage !== null && signal.pl_percentage !== undefined) {
      if (!bestPerformer || signal.pl_percentage > (bestPerformer.pl_percentage || 0)) {
        bestPerformer = signal;
      }
      if (!worstPerformer || signal.pl_percentage < (worstPerformer.pl_percentage || 0)) {
        worstPerformer = signal;
      }
    }
  }

  let performanceText = "";
  
  if (bestPerformer) {
    performanceText += `🏆 **Best:** ${bestPerformer.ticker} (+${bestPerformer.pl_percentage!.toFixed(2)}%)\n`;
  } else {
    performanceText += `🏆 **Best:** N/A\n`;
  }
  
  if (worstPerformer) {
    performanceText += `💀 **Worst:** ${worstPerformer.ticker} (${worstPerformer.pl_percentage!.toFixed(2)}%)\n\n`;
  } else {
    performanceText += `💀 **Worst:** N/A\n\n`;
  }

  performanceText += `**Signals:** ${summary.stats.total_signals}\n`;
  performanceText += `**Wins:** ${summary.stats.wins}\n`;
  performanceText += `**Losses:** ${summary.stats.losses}\n`;
  performanceText += `**Win Rate:** ${summary.stats.win_rate.toFixed(0)}%\n\n`;
  performanceText += `**Monthly Return:** ${summary.stats.total_pl >= 0 ? "+" : ""}${summary.stats.total_pl.toFixed(2)}%\n`;
  performanceText += `**Avg per Signal:** ${summary.stats.average_pl >= 0 ? "+" : ""}${summary.stats.average_pl.toFixed(2)}%\n\n`;
  performanceText += `**BUY Signals:** ${buyCount}\n`;
  performanceText += `**SELL Signals:** ${sellCount}\n\n`;
  performanceText += `📈 **Cumulative Return:** ${summary.cumulative_pl >= 0 ? "+" : ""}${summary.cumulative_pl.toFixed(2)}%`;

  let embedColor = 0x808080;
  if (summary.stats.total_pl > 15) {
    embedColor = 0x00ff00;
  } else if (summary.stats.total_pl > 0) {
    embedColor = 0x90ee90;
  } else if (summary.stats.total_pl < -15) {
    embedColor = 0xff0000;
  } else if (summary.stats.total_pl < 0) {
    embedColor = 0xffa07a;
  }

  const embed: DiscordEmbed = {
    title: `💎 Premium Monthly Performance (${summary.date_label})`,
    description: performanceText,
    color: embedColor,
    footer: {
      text: "TradeLens AI Premium • Not financial advice",
    },
    timestamp: new Date().toISOString(),
  };

  if (summary.chart_url) {
    embed.image = { url: summary.chart_url };
  }

  try {
    await sendWebhook(webhookUrl, [embed]);
    console.log(`Posted premium monthly report for ${summary.date_label}`);
    return true;
  } catch (error) {
    console.error("Failed to post premium monthly report:", error);
    return false;
  }
}
