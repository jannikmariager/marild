import { ema, atr, swingHigh, swingLow } from './indicators.ts';
import type { SignalContext, RuleDecision } from './types.ts';
import type { CryptoShadowConfig } from '../../config.ts';

interface RuleContext extends SignalContext {
  config: CryptoShadowConfig;
}

const MIN_BARS = 20;

export function evaluateRules(ctx: RuleContext): RuleDecision {
  const { bars, timeframe, latestQuote, config } = ctx;
  const reasons: string[] = [];
  const explain: string[] = [];

  if (!bars || bars.length < MIN_BARS) {
    return noTrade('insufficient_bars', [`Need >=${MIN_BARS} bars for signals`]);
  }

  const lastBar = bars[bars.length - 1];
  const tfMs = timeframeMinutes(timeframe) * 60 * 1000;
  const lastTs = new Date(lastBar.ts).getTime();
  if (Date.now() - lastTs > tfMs * 2) {
    return noTrade('stale_bar', ['Latest bar is stale']);
  }

  // Relaxed thresholds
  const maxSpread = Math.max(config.maxSpreadPct, 0.004); // allow wider spread
  const minAtr = Math.min(config.minAtrPct, 0.003);       // allow smaller ATR

  // Spread filter (if quote available)
  if (latestQuote && latestQuote.bid && latestQuote.ask) {
    const spreadPct = (latestQuote.ask - latestQuote.bid) / ((latestQuote.ask + latestQuote.bid) / 2);
    if (spreadPct > maxSpread) {
      return noTrade('spread_high', [`Spread ${spreadPct.toFixed(4)} > max ${maxSpread}`]);
    }
  }

  const closes = bars.map((b) => b.close);
  const atrArr = atr(bars, 14);
  const atrVal = atrArr[atrArr.length - 1] || 0;
  const atrPct = atrVal / lastBar.close;
  if (atrPct < minAtr) {
    return noTrade('atr_low', [`ATR pct ${atrPct.toFixed(4)} < min ${minAtr}`]);
  }

  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const e50 = ema50[ema50.length - 1];
  const e200 = ema200[ema200.length - 1];

  let regime: 'bull' | 'bear' | 'sideways' = 'sideways';
  if (lastBar.close > e50 && e50 > e200) regime = 'bull';
  else if (lastBar.close < e50 && e50 < e200) regime = 'bear';

  // Shorts allowed: no long-only gating

  // Trigger: breakout of swing high/low
  const sh = swingHigh(bars, 20);
  const sl = swingLow(bars, 20);
  const body = Math.abs(lastBar.close - lastBar.open);
  const range = lastBar.high - lastBar.low || 1;
  const bodyPct = body / range;

  const longTrigger =
    regime === 'bull' &&
    sh !== null &&
    lastBar.close > sh &&
    bodyPct >= 0.4 &&
    lastBar.close > e50;

  const shortTrigger =
    !config.longOnly &&
    regime === 'bear' &&
    sl !== null &&
    lastBar.close < sl &&
    bodyPct >= 0.4 &&
    lastBar.close < e50;

  if (!longTrigger && !shortTrigger) {
    return noTrade('no_trigger', ['No breakout trigger']);
  }

  const side: 'long' | 'short' = longTrigger ? 'long' : 'short';

  const structuralStop = side === 'long' ? sl ?? lastBar.low : sh ?? lastBar.high;
  const atrStop = side === 'long' ? lastBar.close - 2.2 * atrVal : lastBar.close + 2.2 * atrVal;
  let stop = side === 'long' ? Math.min(structuralStop ?? atrStop, atrStop) : Math.max(structuralStop ?? atrStop, atrStop);
  const minDist = 1.2 * atrVal;
  const dist = side === 'long' ? lastBar.close - stop : stop - lastBar.close;
  if (dist < minDist) {
    stop = side === 'long' ? lastBar.close - minDist : lastBar.close + minDist;
  }
  const R = dist;
  const tp1 = side === 'long' ? lastBar.close + R : lastBar.close - R;
  const tp2 = side === 'long' ? lastBar.close + 2 * R : lastBar.close - 2 * R;

  explain.push(`Regime=${regime}`, `ATR%=${atrPct.toFixed(4)}`, `Body%=${bodyPct.toFixed(2)}`);

  return {
    decision: 'ENTRY',
    side,
    entry: lastBar.close,
    stop,
    tp1,
    tp2,
    reason_codes: [],
    summary: `${ctx.symbol} ${side} breakout`,
    explain,
    atr: atrVal,
    swingStop: structuralStop ?? undefined,
  };
}

function noTrade(code: string, explain: string[]): RuleDecision {
  return {
    decision: 'NO_TRADE',
    reason_codes: [code],
    summary: code,
    explain,
  };
}

function timeframeMinutes(tf: string): number {
  const t = tf.toLowerCase();
  if (t === '15m' || t === '15min') return 15;
  if (t === '1h' || t === '60m') return 60;
  return 60;
}
