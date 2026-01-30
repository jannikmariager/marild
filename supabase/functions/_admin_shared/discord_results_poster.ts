/**
 * Discord Results Poster
 * Formats and posts daily signal performance reports to Discord
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

export interface SignalResult {
  ticker: string;
  direction: "BUY" | "SELL";
  entry_price: number;
  close_price: number;
  result: "TP1" | "TP2" | "SL" | "OPEN";
  pl_percentage: number;
  confidence: number;
  timeframe: string;
}

export interface DailySummary {
  date: string;
  signals: SignalResult[];
  wins: number;
  losses: number;
  open_trades: number;
  win_rate: number;
  total_pl: number;
}

/**
 * Format signal result for Discord embed field
 */
function formatSignalResult(signal: SignalResult): string {
  const emoji = signal.direction === "BUY" ? "🟢" : "🔻";
  const resultEmoji = {
    TP1: "🎯",
    TP2: "🎯🎯",
    SL: "❌",
    OPEN: "⏳",
  }[signal.result];

  const plColor = signal.pl_percentage >= 0 ? "+" : "";
  
  return `${emoji} **${signal.ticker}** – ${signal.direction}
Entry: $${signal.entry_price.toFixed(2)}
Close: $${signal.close_price.toFixed(2)}
Result: **${resultEmoji} ${signal.result}**
P/L: ${plColor}${signal.pl_percentage.toFixed(2)}%`;
}

/**
 * Post daily performance report to Discord
 */
export async function postDailyResults(summary: DailySummary): Promise<boolean> {
  const webhookUrl = Deno.env.get("DISCORD_RESULTS_WEBHOOK_URL");
  
  if (!webhookUrl) {
    console.warn("DISCORD_RESULTS_WEBHOOK_URL not configured");
    return false;
  }

  // Build signal fields (max 25 fields per embed)
  const signalFields = summary.signals.slice(0, 25).map((signal) => ({
    name: `${signal.ticker} – ${signal.direction}`,
    value: formatSignalResult(signal),
    inline: false,
  }));

  // Build summary section
  const summaryText = `
**Wins:** ${summary.wins}
**Losses:** ${summary.losses}
**Open:** ${summary.open_trades}
**Win Rate:** ${summary.win_rate.toFixed(0)}%
**Total P/L Today:** ${summary.total_pl >= 0 ? "+" : ""}${summary.total_pl.toFixed(2)}%
  `.trim();

  // Determine embed color based on performance
  let embedColor = 0x808080; // Gray for neutral
  if (summary.total_pl > 5) {
    embedColor = 0x00ff00; // Green for strong positive
  } else if (summary.total_pl > 0) {
    embedColor = 0x90ee90; // Light green for positive
  } else if (summary.total_pl < -5) {
    embedColor = 0xff0000; // Red for strong negative
  } else if (summary.total_pl < 0) {
    embedColor = 0xffa07a; // Light red for negative
  }

  const embed = {
    title: `📊 Daily Signal Performance (${summary.date})`,
    description: summary.signals.length === 0 
      ? "No signals generated today." 
      : `Evaluated ${summary.signals.length} signal${summary.signals.length !== 1 ? "s" : ""}.`,
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
      text: "TradeLens AI • Not financial advice",
    },
    timestamp: new Date().toISOString(),
  };

  try {
    await sendWebhook(webhookUrl, [embed]);
    console.log(`Posted daily results for ${summary.date} to Discord`);
    return true;
  } catch (error) {
    console.error("Failed to post daily results to Discord:", error);
    return false;
  }
}

/**
 * Post evaluation error alert to Discord
 */
export async function postEvaluationError(error: string): Promise<void> {
  const webhookUrl = Deno.env.get("DISCORD_RESULTS_WEBHOOK_URL");
  
  if (!webhookUrl) {
    console.warn("DISCORD_RESULTS_WEBHOOK_URL not configured");
    return;
  }

  const embed = {
    title: "⚠️ Signal Evaluation Failed",
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
    console.error("Failed to post error to Discord:", err);
  }
}
