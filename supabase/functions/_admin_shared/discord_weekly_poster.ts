/**
 * Discord Weekly Report Poster
 * Formats and posts weekly signal performance reports to Discord
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
  getWeekNumber,
} from "./signal_evaluator.ts";

export interface WeeklySummary {
  week_number: number;
  year: number;
  signals: Signal[];
  stats: PerformanceStats;
  best_performer: TickerPerformance | null;
  worst_performer: TickerPerformance | null;
}

/**
 * Post weekly performance report to Discord
 */
export async function postWeeklyResults(summary: WeeklySummary): Promise<boolean> {
  const webhookUrl = Deno.env.get("DISCORD_WEEKLY_RESULTS_WEBHOOK_URL");

  if (!webhookUrl) {
    console.warn("DISCORD_WEEKLY_RESULTS_WEBHOOK_URL not configured");
    return false;
  }

  // Build performance summary
  const { stats, best_performer, worst_performer } = summary;

  let performanceText = "";

  // Top and Worst Performers
  if (best_performer) {
    performanceText += `🏆 **Top Performer:** ${best_performer.ticker} (${
      best_performer.pl_percentage >= 0 ? "+" : ""
    }${best_performer.pl_percentage.toFixed(2)}%)\n`;
  }

  if (worst_performer) {
    performanceText += `💀 **Worst Performer:** ${worst_performer.ticker} (${
      worst_performer.pl_percentage >= 0 ? "+" : ""
    }${worst_performer.pl_percentage.toFixed(2)}%)\n`;
  }

  performanceText += "\n";

  // Summary stats
  performanceText += `**Signals:** ${stats.total_signals}\n`;
  performanceText += `**Wins:** ${stats.wins}\n`;
  performanceText += `**Losses:** ${stats.losses}\n`;
  performanceText += `**Open:** ${stats.open_trades}\n`;
  performanceText += `**Win Rate:** ${stats.win_rate.toFixed(0)}%\n\n`;
  performanceText += `**Total Weekly P/L:** ${stats.total_pl >= 0 ? "+" : ""}${stats.total_pl.toFixed(2)}%\n`;
  performanceText += `**Avg P/L per signal:** ${stats.average_pl >= 0 ? "+" : ""}${stats.average_pl.toFixed(2)}%`;

  // Determine embed color based on total P/L
  let embedColor = 0x808080; // Gray for neutral
  if (stats.total_pl > 10) {
    embedColor = 0x00ff00; // Green for strong positive
  } else if (stats.total_pl > 0) {
    embedColor = 0x90ee90; // Light green for positive
  } else if (stats.total_pl < -10) {
    embedColor = 0xff0000; // Red for strong negative
  } else if (stats.total_pl < 0) {
    embedColor = 0xffa07a; // Light red for negative
  }

  const embed = {
    title: `📈 Weekly Performance Report (Week ${summary.week_number}, ${summary.year})`,
    description: summary.signals.length === 0
      ? "No signals generated this week."
      : `Performance summary for ${summary.signals.length} signals.`,
    color: embedColor,
    fields: [
      {
        name: "📊 Performance Summary",
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
    console.log(`Posted weekly results for week ${summary.week_number}, ${summary.year} to Discord`);
    return true;
  } catch (error) {
    console.error("Failed to post weekly results to Discord:", error);
    return false;
  }
}

/**
 * Post weekly evaluation error alert to Discord
 */
export async function postWeeklyEvaluationError(error: string): Promise<void> {
  const webhookUrl = Deno.env.get("DISCORD_WEEKLY_RESULTS_WEBHOOK_URL");

  if (!webhookUrl) {
    console.warn("DISCORD_WEEKLY_RESULTS_WEBHOOK_URL not configured");
    return;
  }

  const embed = {
    title: "⚠️ Weekly Evaluation Failed",
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
    console.error("Failed to post weekly error to Discord:", err);
  }
}
