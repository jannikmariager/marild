/**
 * Premium Discord Signal Embed Builder
 * 
 * Formats TradeSignals with a clean, professional Discord embed layout.
 * Uses the new signal schema with trading_style and structured reasons.
 */

import type { EngineType } from './signal_types.ts';

export interface PremiumSignalData {
  symbol: string;
  signal: "buy" | "sell" | "hold";
  timeframe: string;
  trading_style: "daytrade" | "swing" | "invest";
  engine_type: EngineType;
  engine_version?: 'V3' | 'V3_5' | 'V4' | null;
  confidence_score: number;
  correction_risk: number;
  confluence_score: number;
  base_signal: string;
  summary: string;
  reasons: {
    smc: string;
    price_action: string;
    volume: string;
    sentiment: string;
    fundamentals: string;
    macro: string;
    confluence: string;
  };
  // Price levels for actionable signals
  entry_price?: number;
  stop_loss?: number;
  take_profit_1?: number;
  take_profit_2?: number;
  isCached: boolean;
  cacheAgeMinutes: number;
  source?: "manual" | "hourly"; // User-generated or automated
}

export function buildPremiumDiscordEmbed(signal: PremiumSignalData) {
  // STRICT COLOR RULES - MUST BE VISUALLY OBVIOUS
  const colorMap = {
    buy: 0x00C853,   // GREEN - bright green
    sell: 0xD50000,  // RED - bright red  
    hold: 0x9E9E9E   // GREY - neutral grey
  };

  // Signal direction emoji (color-coded)
  const signalEmoji = {
    buy: "🟢",
    sell: "🔴",
    hold: "⚪"
  };

  const styleEmoji = {
    daytrade: "⚡",
    swing: "🔁",
    invest: "⏳"
  };

  // Display a unified Marild AI label (avoid engine-specific jargon in UX)
  const engineLabel = signal.engine_version
    ? `Marild AI Engine · v${signal.engine_version}`
    : 'Marild AI Engine';

  // Build timestamp status
  const cacheStatus = signal.isCached
    ? `${signal.cacheAgeMinutes} min ago`
    : `Just now`;
  
  const sourceLabel = signal.source === "manual" ? "👤 User Generated" : "🤖 AI Trade Plan";
  
  // Determine conviction level
  const confluence = signal.confluence_score;
  let conviction = "Moderate";
  if (confluence < 30) conviction = "Low";
  else if (confluence >= 50 && confluence < 75) conviction = "High";
  else if (confluence >= 75) conviction = "Strong";
  
  // Determine if risks section is needed
  const showRisks = confluence < 50 || signal.correction_risk > 55;

  // Build fields array
  const fields: any[] = [
    {
      name: "📌 Summary",
      value: signal.summary || "—"
    },
  ];

  // Add AI Trade Plan block for actionable signals (buy/sell)
  if (signal.signal !== "hold" && signal.entry_price && signal.stop_loss && signal.take_profit_1) {
    const tp2Text = signal.take_profit_2
      ? `TP2 (Extended): $${signal.take_profit_2.toFixed(2)}`
      : '';

    const directionLabel = signal.signal === 'sell' ? 'SHORT' : 'LONG';

    fields.push({
      name: `🧠 AI Trade Plan — ${signal.symbol} (${directionLabel})`,
      value:
        `Confidence: ${signal.confidence_score.toFixed(0)}%\n` +
        `Status: ACTIVE\n\n` +
        `ENTRY: $${signal.entry_price.toFixed(2)}\n` +
        `STOP-LOSS: $${signal.stop_loss.toFixed(2)}\n` +
        `TP1 (Primary): $${signal.take_profit_1.toFixed(2)}\n` +
        (tp2Text ? `${tp2Text}\n\n` : '\n') +
        `• Primary target: TP1\n` +
        `• Stop-loss: Fixed\n` +
        `• Discipline: No stop widening, no adding to losers\n\n` +
        `🤖 Model portfolio trades this signal using the plan above.\n` +
        `Manual execution may differ.`,
    });
  }

  // Add analysis details (only meaningful factors)
  const details: string[] = [];
  if (signal.reasons.price_action && !signal.reasons.price_action.toLowerCase().includes('limited')) {
    details.push(`• **Price Action:** ${signal.reasons.price_action}`);
  }
  if (signal.reasons.volume && !signal.reasons.volume.toLowerCase().includes('not yet')) {
    details.push(`• **Volume:** ${signal.reasons.volume}`);
  }
  if (signal.reasons.sentiment && !signal.reasons.sentiment.toLowerCase().includes('limited')) {
    details.push(`• **Sentiment:** ${signal.reasons.sentiment}`);
  }
  if (signal.reasons.smc && !signal.reasons.smc.toLowerCase().includes('limited')) {
    details.push(`• **SMC:** ${signal.reasons.smc}`);
  }
  if (signal.reasons.fundamentals && !signal.reasons.fundamentals.toLowerCase().includes('limited')) {
    details.push(`• **Fundamentals:** ${signal.reasons.fundamentals}`);
  }
  if (signal.reasons.macro && !signal.reasons.macro.toLowerCase().includes('not yet')) {
    details.push(`• **Macro:** ${signal.reasons.macro}`);
  }
  
  if (details.length > 0) {
    fields.push({
      name: "🧩 Details",
      value: details.join('\n')
    });
  }
  
  // Add risks section if needed
  if (showRisks && signal.reasons.confluence) {
    fields.push({
      name: "⚠️ Risks",
      value: signal.reasons.confluence
    });
  }
  
  // Add conviction
  fields.push({
    name: "🎯 Conviction",
    value: conviction,
    inline: true
  });

  // Add timestamp (always show current time for new signals)
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-US', { 
    hour: '2-digit', 
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  });
  const dateStr = now.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
  
  fields.push({
    name: "⏱ Generated",
    value: `${dateStr} ${timeStr} UTC`,
    inline: true
  });

  return {
    username: "TradeLens Signals",
    avatar_url: "https://your-logo-url.png",
    embeds: [
      {
        title: `${signalEmoji[signal.signal]} ${signal.symbol} — ${signal.signal.toUpperCase()} (${signal.timeframe})`,
        description:
          `${engineLabel} • ${sourceLabel}`,
        color: colorMap[signal.signal],
        fields,
        footer: {
          text: "⚠️ Signals are AI-generated analysis, not financial advice. Trading involves risk of loss. Past performance does not guarantee future results."
        },
        timestamp: new Date().toISOString()
      }
    ]
  };
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
