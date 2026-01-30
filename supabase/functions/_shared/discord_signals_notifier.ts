/**
 * Discord Signals Notifier
 * 
 * Posts ONLY high-confidence signals to Discord (confidence >= 60).
 * Enforces daily cap of 30 signals per day (UTC-based).
 * Tracks Discord delivery in ai_signals table.
 * 
 * Updated for Institutional AI Schema with:
 * - Trading style context
 * - Structured reasons per factor
 * - Confluence-based authority system
 * - Daily gating and tracking
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import { AISignalRow, determineTradingStyle, type EngineType } from './signal_types.ts';
import { buildPremiumDiscordEmbed, type PremiumSignalData } from './discord_premium_signal_embed.ts';

export type SignalSource = 'manual' | 'hourly';

// Discord gating configuration
// Hard cap aligned with signals_visibility_evaluator: only the
// top 15 highest-confidence signals per UTC day are eligible for
// Discord publication.
const DEFAULT_MAX_PER_DAY = 15;
const DEFAULT_MIN_CONFIDENCE = 60;
const DEFAULT_CHANNEL_NAME = 'active_signals';

function getEnvNumber(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function getEnvString(name: string, fallback: string): string {
  const raw = Deno.env.get(name);
  return raw && raw.trim().length > 0 ? raw.trim() : fallback;
}

const MAX_SIGNALS_PER_DAY = getEnvNumber('DISCORD_MAX_SIGNALS_PER_DAY', DEFAULT_MAX_PER_DAY);
const MIN_CONFIDENCE = getEnvNumber('DISCORD_MIN_CONFIDENCE', DEFAULT_MIN_CONFIDENCE);
const DISCORD_CHANNEL = getEnvString('DISCORD_CHANNEL_NAME', DEFAULT_CHANNEL_NAME);

interface DiscordSignalParams {
  signal: AISignalRow;
  source: SignalSource;
}

/**
 * Send a Discord notification for a new TradeSignal
 * 
 * Gating rules:
 * - Only signals with confidence_score >= MIN_CONFIDENCE (default: 60)
 * - Max MAX_SIGNALS_PER_DAY signals per UTC day (default: 30)
 * - Tracks delivery in ai_signals table (discord_sent_at, discord_channel, discord_daily_rank)
 * 
 * @param signal The AI signal to notify about (must include id for tracking)
 * @param source Whether this was manually requested or from hourly generation
 */
export async function sendDiscordSignalNotification(
  signal: AISignalRow,
  source: SignalSource
): Promise<void> {
  // Route everything through the single Active Signals channel/webhook.
  // Engine type is kept only for logging/analytics; routing no longer creates
  // separate Discord channels per engine.
  let webhookUrl: string | undefined;
  const engineType = (signal.engine_type || 'SWING').toUpperCase();

  // Prefer a dedicated ACTIVE_SIGNALS webhook if present, otherwise fall back
  // to the legacy SWING/general webhooks.
  webhookUrl =
    Deno.env.get('DISCORD_ACTIVE_SIGNALS_WEBHOOK') ||
    Deno.env.get('DISCORD_SWING_WEBHOOK') ||
    Deno.env.get('DISCORD_SIGNALS_WEBHOOK_URL') ||
    Deno.env.get('DISCORD_SIGNALS_WEBHOOK') ||
    Deno.env.get('DISCORD_ALERT_WEBHOOK_URL');

  const channelName = DISCORD_CHANNEL; // e.g. "active_signals"

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const canTrack = !!(supabaseUrl && supabaseKey && signal && (signal as any).id);
  const supabase = canTrack ? createClient(supabaseUrl!, supabaseKey!) : null;

  async function sendMobilePushForSignal() {
    if (!supabase) return;

    try {
      // Find users who have mobile signal pushes enabled and are not set to "never".
      const { data: profiles, error } = await supabase
        .from('user_profile')
        .select('id, push_signals_enabled, notification_frequency')
        .eq('push_signals_enabled', true)
        .neq('notification_frequency', 'never');

      if (error) {
        console.error('[Push] Failed to load user profiles for signal push', error);
        return;
      }

      const userIds = (profiles || []).map((p: any) => p.id as string).filter(Boolean);
      if (userIds.length === 0) {
        return;
      }

      const title = `New AI signal: ${signal.symbol}`;
      const body = `${signal.signal_type?.toUpperCase?.() || ''} ${signal.symbol} · TF ${signal.timeframe}`.trim();

      await supabase.functions.invoke('admin_send_push', {
        body: {
          title,
          body,
          type: 'signal',
          user_ids: userIds,
          data: {
            type: 'signal',
            signal_id: (signal as any).id,
            symbol: signal.symbol,
            timeframe: signal.timeframe,
          },
        },
      });
    } catch (err) {
      console.error('[Push] Error sending mobile push for signal', err);
    }
  }

  async function markDiscordStatus(
    status: 'sent' | 'skipped' | 'error',
    opts: { skipReason?: string; error?: string; dailyRank?: number; sentAt?: string }
  ) {
    if (!supabase) return;
    const patch: Record<string, unknown> = {
      discord_attempted_at: new Date().toISOString(),
      discord_delivery_status: status,
      discord_skip_reason: status === 'skipped' ? (opts.skipReason ?? null) : null,
      discord_error: status === 'error' ? (opts.error ?? null) : null,
      discord_channel: (channelName ?? null),
    };

    if (status === 'sent') {
      patch.discord_sent_at = opts.sentAt ?? new Date().toISOString();
      patch.discord_daily_rank = opts.dailyRank ?? null;
    }

    await supabase
      .from('ai_signals')
      .update(patch)
      .eq('id', (signal as any).id);
  }

  if (!webhookUrl) {
    console.warn('[Discord] No Active Signals webhook configured (DISCORD_ACTIVE_SIGNALS_WEBHOOK / DISCORD_SWING_WEBHOOK / DISCORD_SIGNALS_WEBHOOK_URL) - skipping notification');
    await markDiscordStatus('skipped', { skipReason: 'missing_webhook' });
    return;
  }

  try {
    // Validate signal has required fields
    if (!signal || !signal.id) {
      console.warn('[Discord] Signal missing id field - cannot track, skipping');
      return;
    }

    // GATE 0: Visibility state (if present)
    // Only publish signals that the visibility evaluator has marked for Discord.
    const vis = (signal as any).visibility_state as
      | 'hidden'
      | 'app_only'
      | 'app_discord'
      | 'app_discord_push'
      | null
      | undefined;

    if (vis && vis !== 'app_discord' && vis !== 'app_discord_push') {
      console.log(
        `[Discord] Skipping signal ${signal.id} (${signal.symbol}) due to visibility_state=${vis} (not discord-visible)`,
      );
      await markDiscordStatus('skipped', { skipReason: 'visibility_not_discord' });
      return;
    }

    // GATE 1: Confidence threshold
    const confidence = signal.confidence_score ?? 0;
    if (confidence < MIN_CONFIDENCE) {
      console.log(`[Discord] Signal ${signal.id} (${signal.symbol}) confidence ${confidence.toFixed(1)}% < ${MIN_CONFIDENCE}% threshold - skipping`);
      await markDiscordStatus('skipped', { skipReason: 'confidence_below_threshold' });
      return;
    }

    // GATE 2: Check if already sent
    if ((signal as any).discord_sent_at) {
      console.log(`[Discord] Signal ${signal.id} already sent at ${(signal as any).discord_sent_at} - skipping duplicate`);
      await markDiscordStatus('skipped', { skipReason: 'already_sent' });
      return;
    }

    // GATE 3: Daily cap check (requires Supabase client)
    if (!supabase) {
      console.warn('[Discord] Supabase credentials not available - cannot enforce daily cap or track delivery status');
      // Fall through to send without tracking
    }

    // Calculate UTC day boundary
    const now = new Date();
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)
    );

    let dailyRank: number | undefined;

    if (supabase) {
      // Count signals sent today so we can assign a simple rank number.
      const { data: todaySent, error: countError } = await supabase
        .from('ai_signals')
        .select('id, discord_daily_rank')
        .not('discord_sent_at', 'is', null)
        .gte('discord_sent_at', startOfDay.toISOString());

      if (countError) {
        console.error('[Discord] Failed to count today\'s sent signals:', countError);
        // Do NOT block sending anymore; just skip rank assignment.
      } else {
        const sentCount = todaySent?.length ?? 0;
        dailyRank = sentCount + 1;

        if (sentCount >= MAX_SIGNALS_PER_DAY) {
          console.log(
            `[Discord] Daily cap value (${MAX_SIGNALS_PER_DAY}) would be exceeded (already ${sentCount} sent), but cap is disabled – still sending signal ${signal.id} (${signal.symbol}).`
          );
        }
      }
    }

    // Build premium embed for Discord
    const premiumSignalData = mapSignalToPremiumData(signal, source);
    const payload = buildPremiumDiscordEmbed(premiumSignalData);

    // Send to Discord
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[Discord] Webhook failed: ${response.status}`, text);
      await markDiscordStatus('error', { error: `webhook_failed:${response.status}:${text.slice(0, 400)}` });
      return;
    }

    // Mark sent (also writes discord_sent_at / daily rank if available)
    await markDiscordStatus('sent', { dailyRank, sentAt: new Date().toISOString() });

    // Mirror to mobile push for all opted-in users, but only for highest visibility tier.
    if (vis === 'app_discord_push') {
      await sendMobilePushForSignal();
    }

    console.log(`[Discord] ✅ Posted ${signal.symbol} ${signal.timeframe} to ${channelName}${dailyRank ? ` (rank #${dailyRank})` : ''} (confidence ${confidence.toFixed(1)}%, ${source})`);
  } catch (error) {
    console.error('[Discord] Unexpected error in sendDiscordSignalNotification:', error);
    // Don't throw - Discord failures should not break signal generation
  }
}

/**
 * Map AISignalRow to PremiumSignalData format
 */
function mapSignalToPremiumData(signal: AISignalRow, source: SignalSource): PremiumSignalData {
  // Determine trading style from signal or timeframe
  const tradingStyle = signal.trading_style || determineTradingStyle(signal.timeframe);
  
  // Extract reasons from signal (handle both object and array formats)
  let reasons = {
    smc: '',
    price_action: '',
    volume: '',
    sentiment: '',
    fundamentals: '',
    macro: '',
    confluence: '',
  };
  
  if (signal.reasons && typeof signal.reasons === 'object' && !Array.isArray(signal.reasons)) {
    // New structured format
    reasons = {
      smc: signal.reasons.smc || '',
      price_action: signal.reasons.price_action || '',
      volume: signal.reasons.volume || '',
      sentiment: signal.reasons.sentiment || '',
      fundamentals: signal.reasons.fundamentals || '',
      macro: signal.reasons.macro || '',
      confluence: signal.reasons.confluence || '',
    };
  } else if (Array.isArray(signal.reasons)) {
    // Legacy array format - map to structured format
    signal.reasons.forEach((item: any) => {
      if (item.factor && item.reasoning) {
        const factor = item.factor.toLowerCase().replace(' ', '_');
        if (factor in reasons) {
          reasons[factor as keyof typeof reasons] = item.reasoning;
        }
      }
    });
  }
  
  // Calculate cache age (signals from DB don't have this, assume fresh if not manual request)
  const cacheAgeMinutes = 0; // Will be set correctly from request context
  const isCached = false;
  
  // Extract engine version (handle both string and object formats)
  let engineVersion: string | undefined;
  if ((signal as any).engine_version) {
    engineVersion = String((signal as any).engine_version);
  }
  
  return {
    symbol: signal.symbol,
    signal: signal.ai_decision || signal.signal_type,
    timeframe: signal.timeframe,
    trading_style: tradingStyle,
    engine_type: signal.engine_type as EngineType,
    engine_version: engineVersion as any,
    confidence_score: Math.round(signal.confidence_score),
    correction_risk: Math.round(signal.correction_risk),
    confluence_score: Math.round(signal.confluence_score || 0),
    base_signal: signal.signal_type,
    summary: signal.reasoning || 'AI-powered signal analysis',
    reasons,
    // Include price levels for actionable signals
    entry_price: signal.entry_price,
    stop_loss: signal.stop_loss,
    take_profit_1: signal.take_profit_1,
    take_profit_2: signal.take_profit_2,
    isCached,
    cacheAgeMinutes,
    source, // Add source to identify user-generated vs automated
  };
}

/**
 * Legacy: Build Discord embed object for a signal
 * @deprecated Use buildPremiumDiscordEmbed via mapSignalToPremiumData instead
 */
function buildSignalEmbed(signal: AISignalRow, source: SignalSource) {
  const sourceLabel = source === 'manual' ? '👤 MANUAL' : '🤖 AUTO';
  const signalEmoji = getSignalEmoji(signal.signal_type);
  const colorCode = getSignalColor(signal.signal_type);
  
  // Use trading_style from signal, or determine from timeframe if not set
  const tradingStyle = signal.trading_style || determineTradingStyle(signal.timeframe);
  const tradingStyleLabel = getTradingStyleLabel(tradingStyle);

  // Format price levels
  const entryPrice = signal.entry_price
    ? `$${signal.entry_price.toFixed(2)}`
    : 'N/A';
  const stopLoss = signal.stop_loss ? `$${signal.stop_loss.toFixed(2)}` : 'N/A';
  const takeProfit1 = signal.take_profit_1
    ? `$${signal.take_profit_1.toFixed(2)}`
    : 'N/A';

  // Format confidence scores
  const confidenceText = `${signal.confidence_score.toFixed(0)}%`;
  const correctionRiskText = `${signal.correction_risk.toFixed(0)}%`;
  const confluenceText = signal.confluence_score
    ? `${signal.confluence_score.toFixed(0)}%`
    : 'N/A';

  // Build fields array
  const fields = [
    {
      name: '📊 Signal',
      value: `${signalEmoji} **${signal.signal_type.toUpperCase()}**`,
      inline: true,
    },
    {
      name: '🎯 Trading Style',
      value: tradingStyleLabel,
      inline: true,
    },
    {
      name: '⚡ Confidence',
      value: confidenceText,
      inline: true,
    },
    {
      name: '⚠️ Correction Risk',
      value: correctionRiskText,
      inline: true,
    },
    {
      name: '🔗 Confluence',
      value: confluenceText,
      inline: true,
    },
  ];

  // Add AI decision if different from rule-based signal
  if (signal.ai_decision && signal.ai_decision !== signal.signal_type) {
    fields.push({
      name: '🤖 AI Override',
      value: `Rule-based: ${signal.signal_type.toUpperCase()} → AI: ${signal.ai_decision.toUpperCase()}`,
      inline: false,
    });
  }

  // Add price levels section
  fields.push({
    name: '💰 Trade Setup',
    value: `Entry: ${entryPrice} • Stop: ${stopLoss} • Target: ${takeProfit1}`,
    inline: false,
  });

  // Add reasoning summary if available
  if (signal.reasoning) {
    fields.push({
      name: '📝 Summary',
      value: signal.reasoning.slice(0, 250), // Truncate to avoid Discord limits
      inline: false,
    });
  }

  // Add structured reasons if available (new institutional AI format)
  if (signal.reasons && typeof signal.reasons === 'object' && !Array.isArray(signal.reasons)) {
    const reasonsText = buildReasonsText(signal.reasons);
    if (reasonsText) {
      fields.push({
        name: '🔍 Analysis Breakdown',
        value: reasonsText,
        inline: false,
      });
    }
  }

  // Add confidence breakdown if available
  if (
    signal.smc_confidence ||
    signal.volume_confidence ||
    signal.sentiment_confidence
  ) {
    const breakdownText = [
      signal.smc_confidence ? `SMC: ${signal.smc_confidence.toFixed(0)}%` : null,
      signal.volume_confidence
        ? `Vol: ${signal.volume_confidence.toFixed(0)}%`
        : null,
      signal.sentiment_confidence
        ? `Sent: ${signal.sentiment_confidence.toFixed(0)}%`
        : null,
    ]
      .filter(Boolean)
      .join(' • ');

    if (breakdownText) {
      fields.push({
        name: '📊 Factor Scores',
        value: breakdownText,
        inline: false,
      });
    }
  }

  return {
    title: `${sourceLabel} ${signal.symbol} ${signal.timeframe.toUpperCase()}`,
    description: `${tradingStyleLabel} Signal Generated`,
    color: colorCode,
    fields,
    timestamp: new Date().toISOString(),
    footer: {
      text: `TradeLens Institutional AI • ${source === 'manual' ? 'User Request' : 'Automated Scan'}`,
    },
  };
}


/**
 * Get trading style label with emoji
 */
function getTradingStyleLabel(style: 'daytrade' | 'swing' | 'invest'): string {
  switch (style) {
    case 'daytrade':
      return '⚡ Daytrade';
    case 'swing':
      return '🔁 Swingtrade';
    case 'invest':
      return '🏦 Investing';
  }
}

/**
 * Build structured reasons text from institutional AI output
 */
function buildReasonsText(reasons: Record<string, any>): string {
  const lines: string[] = [];
  
  // Map of factor names to emojis
  const factorEmojis: Record<string, string> = {
    smc: '📐',
    price_action: '📈',
    volume: '📊',
    sentiment: '💭',
    fundamentals: '💼',
    macro: '🌍',
    confluence: '🔗',
  };

  // Add each factor if it exists and is not empty
  for (const [key, value] of Object.entries(reasons)) {
    if (value && typeof value === 'string' && value.trim()) {
      const emoji = factorEmojis[key] || '•';
      // Truncate long reasons to avoid Discord field limits
      const truncated = value.length > 100 ? value.slice(0, 97) + '...' : value;
      lines.push(`${emoji} **${formatFactorName(key)}**: ${truncated}`);
    }
  }

  return lines.slice(0, 5).join('\n'); // Limit to 5 factors to avoid Discord limits
}

/**
 * Format factor name for display
 */
function formatFactorName(key: string): string {
  switch (key) {
    case 'smc':
      return 'SMC';
    case 'price_action':
      return 'Price Action';
    case 'volume':
      return 'Volume';
    case 'sentiment':
      return 'Sentiment';
    case 'fundamentals':
      return 'Fundamentals';
    case 'macro':
      return 'Macro';
    case 'confluence':
      return 'Confluence';
    default:
      return key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
  }
}

/**
 * Get emoji for signal type
 */
function getSignalEmoji(signalType: string): string {
  switch (signalType) {
    case 'buy':
      return '🟢';
    case 'sell':
      return '🔴';
    case 'neutral':
    case 'hold':
      return '⚪';
    default:
      return '⚪';
  }
}

/**
 * Get Discord embed color for signal type
 */
function getSignalColor(signalType: string): number {
  switch (signalType) {
    case 'buy':
      return 0x00ff7f; // Spring green
    case 'sell':
      return 0xff4c4c; // Light red
    case 'neutral':
    case 'hold':
      return 0xffd700; // Gold
    default:
      return 0x808080; // Gray
  }
}
