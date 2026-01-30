/**
 * Discord Monthly Report Poster
 * Formats and posts monthly signal performance reports to Discord
 */

// Discord webhook helper
interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
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
import type { Signal, PerformanceStats, TickerPerformance } from "./signal_evaluator.ts";
import {
  calculatePerformanceStats,
  findBestPerformer,
  findWorstPerformer,
  countSignalsByDirection,
  getMonthName,
} from "./signal_evaluator.ts";

export interface MonthlySummary {
  month_name: string;
  signals: Signal[];
  stats: PerformanceStats;
  best_performer: TickerPerformance | null;
  worst_performer: TickerPerformance | null;
  buy_count: number;
  sell_count: number;
}

/**
 * Post monthly performance report to Discord
 */
export async function postMonthlyResults(summary: MonthlySummary): Promise<boolean> {
  const webhookUrl = Deno.env.get("DISCORD_MONTHLY_RESULTS_WEBHOOK_URL");

  if (!webhookUrl) {
    console.warn("DISCORD_MONTHLY_RESULTS_WEBHOOK_URL not configured");
    return false;
  }

  // Build performance summary
  const { stats, best_performer, worst_performer, buy_count, sell_count } = summary;

  let performanceText = "";

  // Top and Worst Performers section
  if (best_performer) {
    performanceText += `🏆 **Best Performer:** ${best_performer.ticker} (+${best_performer.pl_percentage.toFixed(2)}%)\n`;
  } else {
    performanceText += `🏆 **Best Performer:** N/A\n`;
  }

  if (worst_performer) {
    performanceText += `💀 **Worst Performer:** ${worst_performer.ticker} (${worst_performer.pl_percentage.toFixed(2)}%)\n\n`;
  } else {
    performanceText += `💀 **Worst Performer:** N/A\n\n`;
  }

  // Summary stats
  performanceText += `**Signals:** ${stats.total_signals}\n`;
  performanceText += `**Wins:** ${stats.wins}\n`;
  performanceText += `**Losses:** ${stats.losses}\n`;
  performanceText += `**Open:** ${stats.open_trades}\n`;
  performanceText += `**Win Rate:** ${stats.win_rate.toFixed(0)}%\n\n`;

  // Monthly P/L
  performanceText += `**Total Monthly P/L:** ${stats.total_pl >= 0 ? "+" : ""}${stats.total_pl.toFixed(2)}%\n`;
  performanceText += `**Average P/L per signal:** ${stats.average_pl >= 0 ? "+" : ""}${stats.average_pl.toFixed(2)}%\n\n`;

  // BUY vs SELL breakdown
  performanceText += `**BUY Signals:** ${buy_count}\n`;
  performanceText += `**SELL Signals:** ${sell_count}`;

  // Determine embed color based on total P/L
  let embedColor = 0x808080; // Gray for neutral
  if (stats.total_pl > 15) {
    embedColor = 0x00ff00; // Green for strong positive
  } else if (stats.total_pl > 0) {
    embedColor = 0x90ee90; // Light green for positive
  } else if (stats.total_pl < -15) {
    embedColor = 0xff0000; // Red for strong negative
  } else if (stats.total_pl < 0) {
    embedColor = 0xffa07a; // Light red for negative
  }

  const embed = {
    title: `📆 Monthly Performance Report (${summary.month_name})`,
    description: summary.signals.length === 0
      ? "No signals generated this month."
      : `Comprehensive performance summary for ${summary.signals.length} signals.`,
    color: embedColor,
    fields: [
      {
        name: "📊 Summary",
        value: performanceText,
        inline: false,
      },
    ],
    footer: {
      text: "TradeLens AI • Not financial advice",
    },
    timestamp: new Date().toISOString(),
  };

  try {
    await sendWebhook(webhookUrl, [embed]);
    console.log(`Posted monthly results for ${summary.month_name} to Discord`);
    return true;
  } catch (error) {
    console.error("Failed to post monthly results to Discord:", error);
    return false;
  }
}

/**
 * Post monthly evaluation error alert to Discord
 */
export async function postMonthlyEvaluationError(error: string): Promise<void> {
  const webhookUrl = Deno.env.get("DISCORD_MONTHLY_RESULTS_WEBHOOK_URL");

  if (!webhookUrl) {
    console.warn("DISCORD_MONTHLY_RESULTS_WEBHOOK_URL not configured");
    return;
  }

  const embed = {
    title: "⚠️ Monthly Evaluation Failed",
    description: error,
    color: 0xff0000, // Red
    timestamp: new Date().toISOString(),
    footer: {
      text: "TradeLens AI",
    },
  };

  try {
    await sendWebhook(webhookUrl, [embed]);
  } catch (err) {
    console.error("Failed to post monthly error to Discord:", err);
  }
}
