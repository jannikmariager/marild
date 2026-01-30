/**
 * Public Discord Performance Formatter
 * 
 * IMPORTANT: This formatter is for PUBLIC channels
 * DO NOT include:
 * - Tickers
 * - Entry prices
 * - TP1/TP2/SL levels
 * - SMC data
 * - Buy/Sell direction
 * - Individual signal details
 * - Timestamps
 * 
 * ONLY show:
 * - Aggregate statistics
 * - Win rate
 * - Total P/L
 * - Number of signals
 * - Equity curve (chart only)
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

export interface PublicPerformanceSummary {
  period_label: string; // "Daily", "Weekly", "Monthly"
  date_label: string; // "29 Nov 2024"
  stats: PerformanceStats;
  cumulative_pl: number;
  chart_url?: string; // Optional equity curve chart
}

/**
 * Format public daily performance report
 * NO sensitive information - only aggregate stats
 */
export async function postPublicDailyReport(
  summary: PublicPerformanceSummary
): Promise<boolean> {
  const webhookUrl = Deno.env.get("DISCORD_PUBLIC_PERFORMANCE_WEBHOOK_URL");
  
  if (!webhookUrl) {
    console.warn("DISCORD_PUBLIC_PERFORMANCE_WEBHOOK_URL not configured");
    return false;
  }

  // Determine embed color based on performance
  let embedColor = 0x808080; // Gray
  if (summary.stats.total_pl > 5) {
    embedColor = 0x00ff00; // Green
  } else if (summary.stats.total_pl > 0) {
    embedColor = 0x90ee90; // Light green
  } else if (summary.stats.total_pl < -5) {
    embedColor = 0xff0000; // Red
  } else if (summary.stats.total_pl < 0) {
    embedColor = 0xffa07a; // Light red
  }

  const performanceText = `
**Signals:** ${summary.stats.total_signals}
**Wins:** ${summary.stats.wins}
**Losses:** ${summary.stats.losses}
**Open Trades:** ${summary.stats.open_trades}
**Win Rate:** ${summary.stats.win_rate.toFixed(0)}%
**Daily Return:** ${summary.stats.total_pl >= 0 ? "+" : ""}${summary.stats.total_pl.toFixed(2)}%

📈 **Cumulative Return:** ${summary.cumulative_pl >= 0 ? "+" : ""}${summary.cumulative_pl.toFixed(2)}%
  `.trim();

  const embed: DiscordEmbed = {
    title: `📊 Daily Performance (${summary.date_label})`,
    description: summary.stats.total_signals === 0
      ? "No signals generated today."
      : performanceText,
    color: embedColor,
    footer: {
      text: "TradeLens AI • Not financial advice",
    },
    timestamp: new Date().toISOString(),
  };

  // Add chart if provided
  if (summary.chart_url) {
    embed.image = { url: summary.chart_url };
  }

  try {
    await sendWebhook(webhookUrl, [embed]);
    console.log(`Posted public daily report for ${summary.date_label}`);
    return true;
  } catch (error) {
    console.error("Failed to post public daily report:", error);
    return false;
  }
}

/**
 * Format public weekly performance report
 */
export async function postPublicWeeklyReport(
  summary: PublicPerformanceSummary
): Promise<boolean> {
  const webhookUrl = Deno.env.get("DISCORD_PUBLIC_PERFORMANCE_WEBHOOK_URL");
  
  if (!webhookUrl) {
    console.warn("DISCORD_PUBLIC_PERFORMANCE_WEBHOOK_URL not configured");
    return false;
  }

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

  const performanceText = `
**Signals:** ${summary.stats.total_signals}
**Wins:** ${summary.stats.wins}
**Losses:** ${summary.stats.losses}
**Win Rate:** ${summary.stats.win_rate.toFixed(0)}%
**Weekly Return:** ${summary.stats.total_pl >= 0 ? "+" : ""}${summary.stats.total_pl.toFixed(2)}%
**Avg per Signal:** ${summary.stats.average_pl >= 0 ? "+" : ""}${summary.stats.average_pl.toFixed(2)}%

📈 **Cumulative Return:** ${summary.cumulative_pl >= 0 ? "+" : ""}${summary.cumulative_pl.toFixed(2)}%
  `.trim();

  const embed: DiscordEmbed = {
    title: `📈 Weekly Performance (${summary.date_label})`,
    description: summary.stats.total_signals === 0
      ? "No signals generated this week."
      : performanceText,
    color: embedColor,
    footer: {
      text: "TradeLens AI • Not financial advice",
    },
    timestamp: new Date().toISOString(),
  };

  if (summary.chart_url) {
    embed.image = { url: summary.chart_url };
  }

  try {
    await sendWebhook(webhookUrl, [embed]);
    console.log(`Posted public weekly report for ${summary.date_label}`);
    return true;
  } catch (error) {
    console.error("Failed to post public weekly report:", error);
    return false;
  }
}

/**
 * Format public monthly performance report
 */
export async function postPublicMonthlyReport(
  summary: PublicPerformanceSummary
): Promise<boolean> {
  const webhookUrl = Deno.env.get("DISCORD_PUBLIC_PERFORMANCE_WEBHOOK_URL");
  
  if (!webhookUrl) {
    console.warn("DISCORD_PUBLIC_PERFORMANCE_WEBHOOK_URL not configured");
    return false;
  }

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

  const performanceText = `
**Signals:** ${summary.stats.total_signals}
**Wins:** ${summary.stats.wins}
**Losses:** ${summary.stats.losses}
**Win Rate:** ${summary.stats.win_rate.toFixed(0)}%
**Monthly Return:** ${summary.stats.total_pl >= 0 ? "+" : ""}${summary.stats.total_pl.toFixed(2)}%
**Avg per Signal:** ${summary.stats.average_pl >= 0 ? "+" : ""}${summary.stats.average_pl.toFixed(2)}%

📈 **Cumulative Return:** ${summary.cumulative_pl >= 0 ? "+" : ""}${summary.cumulative_pl.toFixed(2)}%
  `.trim();

  const embed: DiscordEmbed = {
    title: `📆 Monthly Performance (${summary.date_label})`,
    description: summary.stats.total_signals === 0
      ? "No signals generated this month."
      : performanceText,
    color: embedColor,
    footer: {
      text: "TradeLens AI • Not financial advice",
    },
    timestamp: new Date().toISOString(),
  };

  if (summary.chart_url) {
    embed.image = { url: summary.chart_url };
  }

  try {
    await sendWebhook(webhookUrl, [embed]);
    console.log(`Posted public monthly report for ${summary.date_label}`);
    return true;
  } catch (error) {
    console.error("Failed to post public monthly report:", error);
    return false;
  }
}
