'use server';

import { createAdminClient } from '@/lib/supabase/server';
import { postTradingSignal, postDailySummary, type TradingSignal } from '@/lib/discord-signals';

/**
 * Post a specific signal to Discord
 */
export async function postSignalToDiscord(signalId: string) {
  try {
    const supabase = await createAdminClient();
    
    // Fetch the signal from database
    const { data: signal, error } = await supabase
      .from('ai_signals')
      .select('*')
      .eq('id', signalId)
      .single();

    if (error || !signal) {
      return { success: false, error: 'Signal not found' };
    }

    // Format for Discord
    const tradingSignal: TradingSignal = {
      symbol: signal.symbol,
      signal: signal.signal_type.toUpperCase() as 'BUY' | 'SELL' | 'HOLD' | 'NEUTRAL',
      confidence: signal.confidence_score,
      currentPrice: signal.smc_data?.current_price || 0,
      targetPrice1: signal.smc_data?.target_price_1 || signal.smc_data?.target_price,
      targetPrice2: signal.smc_data?.target_price_2,
      stopLoss: signal.smc_data?.stop_loss,
      timeframe: signal.timeframe,
      reasons: signal.reasons?.items || [],
      correctionRisk: signal.correction_risk,
      entryRange: signal.smc_data?.entry_range,
      trigger: signal.smc_data?.entry_trigger,
      smcData: {
        orderBlocks: signal.smc_data?.order_blocks,
        fairValueGaps: signal.smc_data?.fair_value_gaps,
        liquidityZones: signal.smc_data?.liquidity_zones,
      },
    };

    const success = await postTradingSignal(tradingSignal);

    if (!success) {
      return { success: false, error: 'Failed to post to Discord' };
    }

    // Update signal as posted
    await supabase
      .from('ai_signals')
      .update({ posted_to_discord: true })
      .eq('id', signalId);

    return { success: true };
  } catch (error) {
    console.error('Error posting signal to Discord:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Post all unposted signals to Discord
 */
export async function postAllSignalsToDiscord() {
  try {
    const supabase = await createAdminClient();
    
    // Fetch unposted signals from today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: signals, error } = await supabase
      .from('ai_signals')
      .select('*')
      .gte('created_at', today.toISOString())
      .is('posted_to_discord', null)
      .order('confidence_score', { ascending: false })
      .limit(10);

    if (error || !signals || signals.length === 0) {
      return { success: false, error: 'No unposted signals found' };
    }

    let posted = 0;
    for (const signal of signals) {
      const result = await postSignalToDiscord(signal.id);
      if (result.success) posted++;
      
      // Rate limit: 1 signal per second
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return { 
      success: true, 
      posted, 
      total: signals.length 
    };
  } catch (error) {
    console.error('Error posting signals to Discord:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Post daily summary to Discord
 */
export async function postDailySummaryToDiscord() {
  try {
    const supabase = await createAdminClient();
    
    // Get today's signals
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: signals } = await supabase
      .from('ai_signals')
      .select('signal_type, confidence_score, symbol')
      .gte('created_at', today.toISOString());

    if (!signals) {
      return { success: false, error: 'No signals found' };
    }

    const buySignals = signals.filter(s => s.signal_type === 'buy').length;
    const sellSignals = signals.filter(s => s.signal_type === 'sell').length;
    
    // Get top 3 performers by confidence
    const topPerformers = signals
      .sort((a, b) => b.confidence_score - a.confidence_score)
      .slice(0, 3)
      .map(s => s.symbol);

    const marketSentiment = buySignals > sellSignals 
      ? '🟢 Bullish' 
      : sellSignals > buySignals 
      ? '🔴 Bearish' 
      : '⚪ Neutral';

    const success = await postDailySummary({
      totalSignals: signals.length,
      buySignals,
      sellSignals,
      topPerformers,
      marketSentiment,
    });

    return { success };
  } catch (error) {
    console.error('Error posting daily summary:', error);
    return { success: false, error: String(error) };
  }
}
