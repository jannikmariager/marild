// Shared configuration helpers for Supabase Edge Functions
// Single source of truth for engine flags and feature gates.

export type EngineKey = 'swing';

export function getActiveEngine(): EngineKey {
  const raw = (Deno.env.get('MARILD_ACTIVE_ENGINE') || '').toLowerCase();
  // For now we only support swing as the live engine.
  if (raw === 'swing') return 'swing';
  return 'swing';
}

export function isDaytraderDisabled(): boolean {
  const raw = Deno.env.get('MARILD_DISABLE_DAYTRADER');
  return raw === 'true' || raw === '1';
}

/**
 * Crypto shadow engine configuration (single source of truth).
 */
export interface CryptoShadowConfig {
  enabled: boolean;
  universe: string[];
  primaryTimeframes: string[];
  riskPerTrade: number;
  maxConcurrent: number;
  maxDailyDrawdown: number;
  minAtrPct: number;
  maxSpreadPct: number;
  feeBps: number;
  slippageBps: number;
  longOnly: boolean;
  trailEnabled: boolean;
  decisionLogRetentionDays: number;
}

function parseBool(val: string | undefined, defaultValue: boolean): boolean {
  if (val === undefined) return defaultValue;
  return val === 'true' || val === '1';
}

function parseNumber(val: string | undefined, defaultValue: number): number {
  if (val === undefined || val === '') return defaultValue;
  const n = Number(val);
  return Number.isFinite(n) ? n : defaultValue;
}

export function getCryptoShadowConfig(): CryptoShadowConfig {
  const env = (key: string) => Deno.env.get(key);
  return {
    enabled: parseBool(env('CRYPTO_SHADOW_ENABLED'), false),
    universe: (env('CRYPTO_UNIVERSE') || 'BTC/USD,ETH/USD,SOL/USD,ADA/USD,MATIC/USD')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    primaryTimeframes: (env('CRYPTO_PRIMARY_TIMEFRAMES') || '15m')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    riskPerTrade: parseNumber(env('CRYPTO_RISK_PER_TRADE'), 0.003),
    maxConcurrent: parseNumber(env('CRYPTO_MAX_CONCURRENT_POSITIONS'), 3),
    maxDailyDrawdown: parseNumber(env('CRYPTO_MAX_DAILY_DRAWDOWN'), 0.02),
    minAtrPct: parseNumber(env('CRYPTO_MIN_ATR_PCT'), 0.003),
    maxSpreadPct: parseNumber(env('CRYPTO_MAX_SPREAD_PCT'), 0.004),
    feeBps: parseNumber(env('CRYPTO_FEE_BPS'), 10),
    slippageBps: parseNumber(env('CRYPTO_SLIPPAGE_BPS'), 2),
    longOnly: parseBool(env('CRYPTO_LONG_ONLY'), false),
    trailEnabled: parseBool(env('CRYPTO_TRAIL_ENABLED'), true),
    decisionLogRetentionDays: parseNumber(env('CRYPTO_DECISION_LOG_RETENTION_DAYS'), 90),
  };
}

export function logEngineConfigOnce(context: string) {
  // Lightweight log helper to see config on cold start / first invocation.
  console.log(`[${context}] Daytrader disabled: ${isDaytraderDisabled()}`);
  console.log(`[${context}] Active engine: ${getActiveEngine()}`);
  const crypto = getCryptoShadowConfig();
  console.log(
    `[${context}] Crypto shadow enabled=${crypto.enabled} universe=${crypto.universe.join(
      ',',
    )} timeframes=${crypto.primaryTimeframes.join(',')}`,
  );
}

// ------------------------------------------------------------
// Focus Universe V2 config
// ------------------------------------------------------------

export type FocusVolatilityGateMode = 'LIST' | 'ATR_PCT' | 'HYBRID';

export interface FocusConfig {
  primaryMinConf: number;
  momentumMinConf: number;
  momentumMaxConf: number;
  lookbackHours: number;
  maxTickers: number;
  minFocusSize: number;
  missedListSize: number;
  volatilityGateMode: FocusVolatilityGateMode;
  volatilityTickerList: string[];
  atrPercentileMin: number;
  atrLookbackDays: number;
  enableDbAudit: boolean;
  enableVerboseLogs: boolean;
}

export function getFocusConfig(): FocusConfig {
  const env = (key: string) => Deno.env.get(key);
  const parseList = (val: string | undefined, fallback: string[]): string[] =>
    (val || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean).length > 0
      ? (val || '')
          .split(',')
          .map((s) => s.trim().toUpperCase())
          .filter(Boolean)
      : fallback;

  const defaultMomentumList = [
    'MARA',
    'NIO',
    'RIOT',
    'COIN',
    'TSLA',
    'NVDA',
    'PLTR',
    'SOFI',
    'TNA',
    'LABU',
    'SHOP',
    'AFRM',
    'DKNG',
  ];

  const gateMode = (env('FOCUS_VOLATILITY_GATE_MODE') || 'HYBRID').toUpperCase() as FocusVolatilityGateMode;
  const mode: FocusVolatilityGateMode = ['LIST', 'ATR_PCT', 'HYBRID'].includes(gateMode)
    ? gateMode
    : 'HYBRID';

  return {
    primaryMinConf: parseNumber(env('FOCUS_PRIMARY_MIN_CONFIDENCE'), 55),
    momentumMinConf: parseNumber(env('FOCUS_MOMENTUM_MIN_CONFIDENCE'), 48),
    momentumMaxConf: parseNumber(env('FOCUS_MOMENTUM_MAX_CONFIDENCE'), 54),
    lookbackHours: parseNumber(env('FOCUS_LOOKBACK_HOURS'), 24),
    maxTickers: parseNumber(env('FOCUS_MAX_TICKERS'), 30),
    minFocusSize: parseNumber(env('MIN_FOCUS_SIZE'), 25),
    missedListSize: parseNumber(env('FOCUS_MISSED_LIST_SIZE'), 20),
    volatilityGateMode: mode,
    volatilityTickerList: parseList(env('FOCUS_VOLATILITY_TICKER_LIST'), defaultMomentumList),
    atrPercentileMin: parseNumber(env('FOCUS_ATR_PERCENTILE_MIN'), 0.7),
    atrLookbackDays: parseNumber(env('FOCUS_ATR_LOOKBACK_DAYS'), 14),
    enableDbAudit: parseBool(env('FOCUS_ENABLE_DB_AUDIT'), true),
    enableVerboseLogs: parseBool(env('FOCUS_ENABLE_VERBOSE_LOGS'), true),
  };
}
