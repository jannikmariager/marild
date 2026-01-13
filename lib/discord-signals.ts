/**
 * Discord Trading Signals Integration
 * Posts AI-generated trading signals to Discord channel via webhook
 */

export interface TradingSignal {
  symbol: string;
  signal: 'BUY' | 'SELL' | 'HOLD' | 'NEUTRAL';
  confidence: number; // 0-100
  currentPrice: number;
  targetPrice1?: number; // First target
  targetPrice2?: number; // Second target (optional)
  stopLoss?: number;
  timeframe: string;
  reasons: string[]; // Should have exactly 4 analysis points
  correctionRisk?: number;
  entryRange?: string; // e.g. "$180-$182"
  trigger?: string; // Entry trigger condition
  smcData?: {
    orderBlocks?: string[]; // Array of OB levels
    fairValueGaps?: string[]; // Array of FVG levels
    liquidityZones?: string[]; // Array of liquidity levels
  };
}

/**
 * Format trading signal as Discord embed message
 */
function formatSignalEmbed(signal: TradingSignal) {
  const signalColors = {
    BUY: 0x00ff00,      // Green
    SELL: 0xff0000,     // Red
    HOLD: 0xffff00,     // Yellow
    NEUTRAL: 0x808080,  // Gray
  };

  const signalEmojis = {
    BUY: '🟢',
    SELL: '🔻',
    HOLD: '🟡',
    NEUTRAL: '⚪',
  };

  const color = signalColors[signal.signal];
  const emoji = signalEmojis[signal.signal];

  // Build description with key info
  let description = `**Current Price:** $${signal.currentPrice.toFixed(2)}\n`;
  description += `**Confidence:** ${signal.confidence}%\n`;
  description += `**Timeframe:** ${signal.timeframe}\n`;

  // Targets (TP1 → TP2 format)
  if (signal.targetPrice1 && signal.targetPrice2) {
    description += `**Targets:** $${signal.targetPrice1.toFixed(2)} → $${signal.targetPrice2.toFixed(2)}\n`;
  } else if (signal.targetPrice1) {
    description += `**Target:** $${signal.targetPrice1.toFixed(2)}\n`;
  }

  if (signal.stopLoss) {
    description += `**Stop Loss:** $${signal.stopLoss.toFixed(2)}\n`;
  }
  if (signal.correctionRisk !== undefined) {
    description += `**Correction Risk:** ${signal.correctionRisk}%\n`;
  }

  // Add reasoning
  if (signal.reasons.length > 0) {
    description += `\n**Analysis:**\n`;
    signal.reasons.forEach(reason => {
      description += `• ${reason}\n`;
    });
  }

  // Add SMC data if available
  if (signal.smcData) {
    const smcParts = [];
    if (signal.smcData.orderBlocks?.length) {
      smcParts.push(`OB: ${signal.smcData.orderBlocks.join(', ')}`);
    }
    if (signal.smcData.fairValueGaps?.length) {
      smcParts.push(`FVG: ${signal.smcData.fairValueGaps.join(', ')}`);
    }
    if (signal.smcData.liquidityZones?.length) {
      smcParts.push(`LIQ: ${signal.smcData.liquidityZones.join(', ')}`);
    }
    
    if (smcParts.length > 0) {
      description += `\n**SMC Levels:**\n${smcParts.join(' | ')}`;
    }
  }

  return {
    embeds: [{
      title: `${emoji} ${signal.signal} Signal: ${signal.symbol}`,
      description,
      color,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'TradeLens AI • Not financial advice',
      },
    }],
  };
}

/**
 * Save signal to database via Edge Function
 */
async function saveSignalToDatabase(signal: TradingSignal): Promise<boolean> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      console.warn('Supabase credentials not configured, skipping database save');
      return false;
    }

    const response = await fetch(`${supabaseUrl}/functions/v1/save_signal`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        ticker: signal.symbol,
        direction: signal.signal,
        entry_price: signal.currentPrice,
        tp1: signal.targetPrice1,
        tp2: signal.targetPrice2,
        sl: signal.stopLoss,
        confidence: signal.confidence,
        timeframe: signal.timeframe,
        reasons: signal.reasons,
        smc_data: signal.smcData,
      }),
    });

    if (!response.ok) {
      console.error('Failed to save signal to database:', response.statusText);
      return false;
    }

    console.log(`✅ Saved ${signal.signal} signal for ${signal.symbol} to database`);
    return true;
  } catch (error) {
    console.error('Error saving signal to database:', error);
    return false;
  }
}

/**
 * Post trading signal to Discord channel AND save to database
 */
export async function postTradingSignal(signal: TradingSignal): Promise<boolean> {
  try {
    const webhookUrl = process.env.DISCORD_SIGNALS_WEBHOOK;
    
    if (!webhookUrl) {
      console.error('DISCORD_SIGNALS_WEBHOOK not configured');
      return false;
    }

    const payload = formatSignalEmbed(signal);

    // Post to Discord
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('Failed to post signal to Discord:', response.statusText);
      return false;
    }

    console.log(`✅ Posted ${signal.signal} signal for ${signal.symbol} to Discord`);

    // Save to database (don't fail if this fails)
    await saveSignalToDatabase(signal);

    return true;
  } catch (error) {
    console.error('Error posting signal to Discord:', error);
    return false;
  }
}

/**
 * Post multiple signals as a batch
 */
export async function postSignalsBatch(signals: TradingSignal[]): Promise<void> {
  if (signals.length === 0) return;

  // Post signals with 1 second delay to avoid rate limiting
  for (const signal of signals) {
    await postTradingSignal(signal);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

/**
 * Post daily market summary to Discord
 */
export async function postDailySummary(summary: {
  totalSignals: number;
  buySignals: number;
  sellSignals: number;
  topPerformers: string[];
  marketSentiment: string;
}): Promise<boolean> {
  try {
    const webhookUrl = process.env.DISCORD_SIGNALS_WEBHOOK;
    
    if (!webhookUrl) {
      console.error('DISCORD_SIGNALS_WEBHOOK not configured');
      return false;
    }

    const payload = {
      embeds: [{
        title: '📊 Daily Trading Summary',
        description: `Market analysis for ${new Date().toLocaleDateString()}`,
        color: 0x3b82f6, // Blue
        fields: [
          {
            name: '🎯 Signals Generated',
            value: summary.totalSignals.toString(),
            inline: true,
          },
          {
            name: '🟢 Buy Signals',
            value: summary.buySignals.toString(),
            inline: true,
          },
          {
            name: '🔴 Sell Signals',
            value: summary.sellSignals.toString(),
            inline: true,
          },
          {
            name: '🏆 Top Performers',
            value: summary.topPerformers.join(', ') || 'None',
            inline: false,
          },
          {
            name: '💭 Market Sentiment',
            value: summary.marketSentiment,
            inline: false,
          },
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'TradeLens AI',
        },
      }],
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    return response.ok;
  } catch (error) {
    console.error('Error posting daily summary to Discord:', error);
    return false;
  }
}
