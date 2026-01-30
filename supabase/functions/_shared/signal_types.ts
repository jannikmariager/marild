import { resolveEngineMetadata } from "./engine_metadata.ts";

/**
 * Shared Type Definitions for TradeLens AI Signal Pipeline
 * Phase 2: Real Data Integration
 * 
 * These types define the contract between data fetchers, scorers, AI evaluators,
 * and storage layers. They match the ai_signals database schema exactly.
 */

// ============================================================
// BASE DATA TYPES (from external APIs)
// ============================================================

export interface OHLCBar {
  timestamp: string; // ISO 8601
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface QuoteData {
  ticker: string;
  current_price: number;
  change: number;
  change_percent: number;
  volume: number;
  avg_volume?: number;
  market_cap?: number;
  day_high?: number;
  day_low?: number;
  week_52_high?: number;
  week_52_low?: number;
  previous_close?: number;
}

export interface FundamentalsData {
  ticker: string;
  market_cap?: number;
  pe_ratio?: number;
  eps?: number;
  dividend_yield?: number;
  beta?: number;
  revenue_per_share?: number;
  book_value_per_share?: number;
  free_cash_flow_per_share?: number;
  profit_margin?: number;
  operating_margin?: number;
  return_on_equity?: number;
  shares_outstanding?: number;
}

export interface AnalystData {
  ticker: string;
  rating_buy?: number;
  rating_hold?: number;
  rating_sell?: number;
  target_high?: number;
  target_low?: number;
  target_mean?: number;
  target_median?: number;
  updated_at?: string;
}

export interface NewsItem {
  id: string;
  headline: string;
  summary?: string;
  content?: string;
  source: string;
  author?: string;
  published_at: string; // ISO 8601
  image_url?: string;
  url?: string;
  sentiment: 'bullish' | 'neutral' | 'bearish';
  ai_summary?: string;
}

// ============================================================
// SMC DATA TYPES (from database)
// ============================================================

export interface OrderBlock {
  id?: string;
  ticker: string;
  timeframe: string;
  direction: 'bullish' | 'bearish';
  high: number;
  low: number;
  open_time: string;
  close_time: string;
  mitigated: boolean;
  mitigation_time?: string;
  origin: string; // 'bos' | 'choch' | 'swing'
  created_at?: string;
}

export interface BOSEvent {
  id?: string;
  ticker: string;
  timeframe: string;
  direction: 'up' | 'down';
  price: number;
  event_time: string;
  strength: number; // 0-100
  created_at?: string;
}

export interface SessionRange {
  id?: string;
  ticker: string;
  session_date: string;
  session_type: 'asian' | 'london' | 'newyork';
  high: number;
  low: number;
  open_time: string;
  close_time: string;
  created_at?: string;
}

export interface SMCData {
  order_blocks: OrderBlock[];
  bos_events: BOSEvent[];
  session_ranges: SessionRange[];
  liquidity_zones?: Array<{
    type: 'high' | 'low';
    price: number;
    timestamp: string;
  }>;
}

// ============================================================
// VOLUME ANALYSIS TYPES
// ============================================================

export interface VolumeMetrics {
  current_volume: number;
  avg_volume_20d: number;
  relative_volume: number; // current / avg (e.g. 1.5 = 50% above average)
  volume_trend: 'increasing' | 'decreasing' | 'stable';
  volume_spike: boolean; // true if relative_volume > 1.5
  order_flow_bias: 'bullish' | 'bearish' | 'neutral';
  vwap?: number; // Volume Weighted Average Price
  vwap_distance?: number; // % distance from VWAP
}

export interface VolumeData {
  metrics: VolumeMetrics;
  raw_volume: number;
  avg_volume: number;
  relative_volume: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  order_flow_bias: 'bullish' | 'bearish' | 'neutral';
}

// ============================================================
// SENTIMENT ANALYSIS TYPES
// ============================================================

export interface SentimentData {
  overall: 'bullish' | 'neutral' | 'bearish';
  score: number; // -100 (very bearish) to +100 (very bullish)
  news_count: number;
  news_headlines: string[];
  weighted_sentiment: number; // recency-weighted score
  bullish_count: number;
  bearish_count: number;
  neutral_count: number;
  sources: Array<{
    headline: string;
    sentiment: 'bullish' | 'neutral' | 'bearish';
    published_at: string;
    weight: number; // recency weight (0-2)
  }>;
}

// ============================================================
// RAW SIGNAL INPUT (Pre-AI Evaluation)
// ============================================================

export interface RawSignalInput {
  symbol: string;
  timeframe: string;
  
  // Market data
  ohlcv: OHLCBar[];
  quote: QuoteData;
  fundamentals?: FundamentalsData;
  analyst?: AnalystData | null;
  
  // News & sentiment
  news: NewsItem[];
  news_sentiment?: any; // NewsSentimentSummary from signal_news_sentiment.ts
  
  // Technical analysis
  smc: SMCData;
  volume_metrics: VolumeMetrics;
  sentiment_score: number; // -100 to 100
  
  // Rule-based preliminary signal
  raw_signal_type: 'buy' | 'sell' | 'neutral';
  raw_confidence: number; // 0-100
  
  // Confidence breakdown
  smc_confidence: number; // 0-100
  volume_confidence: number; // 0-100
  sentiment_confidence: number; // 0-100
  confluence_score: number; // 0-100 (overall alignment)
  
  // Metadata
  fetched_at: string; // ISO 8601
}

// ============================================================
// EVALUATED SIGNAL (Post-AI Evaluation)
// ============================================================

export type EngineType = 'DAYTRADER' | 'SWING' | 'INVESTOR';

export interface EvaluatedSignal {
  // Identity
  id?: string;
  symbol: string;
  timeframe: string;
  trading_style?: 'daytrade' | 'swing' | 'invest';
  engine_type: EngineType;
  
  // Signal decision
  signal_type: 'buy' | 'sell' | 'neutral'; // Final decision
  ai_decision?: 'buy' | 'sell' | 'neutral'; // AI override if different
  
  // Price levels
  entry_price: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2?: number;
  
  // Confidence scores
  confidence_score: number; // 0-100 (final)
  smc_confidence: number; // 0-100
  volume_confidence: number; // 0-100
  sentiment_confidence: number; // 0-100
  confluence_score: number; // 0-100
  correction_risk: number; // 0-100
  
  // Explanations
  reasoning: string; // AI-generated 2-3 sentence rationale
  risk_factors?: string[]; // Array of risk warnings
  
  // Supporting data (stored as JSONB)
  smc_data: {
    order_blocks: Array<{
      direction: 'bullish' | 'bearish';
      price_range: string; // e.g. "$175.20 - $176.50"
      status: 'active' | 'mitigated';
    }>;
    bos_events: Array<{
      direction: 'up' | 'down';
      price: number;
      time: string;
    }>;
    key_level?: string; // e.g. "$175.85"
    structure_bias?: 'bullish' | 'bearish' | 'neutral';
  };
  
  volume_data: {
    relative_volume: number;
    trend: 'increasing' | 'decreasing' | 'stable';
    order_flow_bias: 'bullish' | 'bearish' | 'neutral';
    vwap_distance?: number;
  };
  
  sentiment_data: {
    overall: 'bullish' | 'neutral' | 'bearish';
    score: number; // -100 to 100
    news_count: number;
    headlines: string[];
  };
  
  fundamentals?: FundamentalsData; // Fundamental metrics from Finnhub/FMP
  
  reasons?: {
    items: string[];
  };
  
  // Evaluation metadata
  sentiment_score: number; // -100 to 100
  accuracy_after_7d?: number; // Filled by daily evaluation job
  
  // Cache metadata
  is_manual_request?: boolean;
  cached_source?: boolean;
  
  // Timestamps
  created_at?: string;
  updated_at?: string;
}

// ============================================================
// DATABASE ROW TYPE (matches ai_signals table exactly)
// ============================================================

export interface AISignalRow {
  id: string;
  symbol: string;
  timeframe: string;
  trading_style?: 'daytrade' | 'swing' | 'invest'; // TEXT (Phase 2)
  engine_type: EngineType; // Signal engine: DAYTRADER | SWING | INVESTOR
  engine_version?: string | null;
  engine_key?: string | null;
  engine_style?: string | null;
  signal_type: 'buy' | 'sell' | 'neutral';
  confidence_score: number; // NUMERIC(5,2)
  correction_risk: number; // NUMERIC(5,2)
  
  // Price levels (Phase 2 additions)
  entry_price?: number; // NUMERIC(12,4)
  stop_loss?: number; // NUMERIC(12,4)
  take_profit_1?: number; // NUMERIC(12,4)
  take_profit_2?: number; // NUMERIC(12,4)
  
  // Confidence breakdown (Phase 2 additions)
  smc_confidence?: number; // NUMERIC(5,2)
  volume_confidence?: number; // NUMERIC(5,2)
  sentiment_confidence?: number; // NUMERIC(5,2)
  confluence_score?: number; // NUMERIC(5,2)
  
  // Text fields
  reasoning?: string; // TEXT
  ai_decision?: string; // TEXT
  
  // JSONB fields
  reasons?: Record<string, any>; // JSONB
  smc_data?: Record<string, any>; // JSONB
  volume_data?: Record<string, any>; // JSONB (Phase 2)
  sentiment_data?: Record<string, any>; // JSONB (Phase 2)
  fundamentals?: Record<string, any>; // JSONB - Fundamental data from Finnhub/FMP
  
  // Scores
  sentiment_score: number; // NUMERIC(5,2) -100 to 100
  accuracy_after_7d?: number; // NUMERIC(5,2)
  
  // Visibility / publishing
  visibility_state?: 'hidden' | 'app_only' | 'app_discord' | 'app_discord_push' | null;
  published_at?: string | null;
  upgraded_from_signal_id?: string | null;
  trade_gate_allowed?: boolean;
  trade_gate_reason?: TradeGateReason | null;
  trade_gate_et_time?: string | null;
  blocked_until_et?: string | null;
  
  // Cache metadata
  source?: 'user_requested' | 'performance_engine'; // Signal origin
  is_manual_request?: boolean;
  cached_source?: boolean;
  
  // Timestamps
  created_at: string;
  updated_at?: string;
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Convert EvaluatedSignal to AISignalRow for database insertion
 */
export type TradeGateReason =
  | 'TRADE_ALLOWED'
  | 'MARKET_CLOSED_DAY'
  | 'OPENING_WINDOW_NO_TRADE'
  | 'CLOSE_WINDOW_NO_TRADE';

export function signalToRow(
  signal: EvaluatedSignal,
  is_manual_request = false,
  overrides: Partial<Omit<AISignalRow, 'id' | 'created_at' | 'updated_at'>> = {},
): Omit<AISignalRow, 'id' | 'created_at' | 'updated_at'> {
  const engineVersion =
    overrides.engine_version ?? (signal as any).engine_version ?? null;
  const metadata = resolveEngineMetadata(signal.engine_type, engineVersion);
  const engineKey = overrides.engine_key ?? metadata.engine_key;
  const engineStyle = overrides.engine_style ?? metadata.engine_style;
  return {
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    trading_style: signal.trading_style,
    engine_type: signal.engine_type,
    engine_version: engineVersion,
    engine_key: engineKey,
    engine_style: engineStyle,
    signal_type: signal.signal_type,
    confidence_score: signal.confidence_score,
    correction_risk: signal.correction_risk,
    
    entry_price: signal.entry_price,
    stop_loss: signal.stop_loss,
    take_profit_1: signal.take_profit_1,
    take_profit_2: signal.take_profit_2,
    
    smc_confidence: signal.smc_confidence,
    volume_confidence: signal.volume_confidence,
    sentiment_confidence: signal.sentiment_confidence,
    confluence_score: signal.confluence_score,
    
    reasoning: signal.reasoning,
    ai_decision: signal.ai_decision,
    
    reasons: signal.reasons,
    smc_data: signal.smc_data,
    volume_data: signal.volume_data,
    sentiment_data: signal.sentiment_data,
    fundamentals: signal.fundamentals as Record<string, any> | undefined,
    
    sentiment_score: signal.sentiment_score,
    accuracy_after_7d: signal.accuracy_after_7d,
    
    source: is_manual_request ? 'user_requested' : 'performance_engine',
    is_manual_request,
    cached_source: false,
    ...overrides,
  };
}

/**
 * Validate that all required fields are present in EvaluatedSignal
 */
export function validateSignal(signal: Partial<EvaluatedSignal>): signal is EvaluatedSignal {
  const required: Array<keyof EvaluatedSignal> = [
    'symbol',
    'timeframe',
    'signal_type',
    'entry_price',
    'stop_loss',
    'take_profit_1',
    'confidence_score',
    'smc_confidence',
    'volume_confidence',
    'sentiment_confidence',
    'confluence_score',
    'correction_risk',
    'reasoning',
    'smc_data',
    'volume_data',
    'sentiment_data',
    'sentiment_score',
  ];
  
  return required.every(field => signal[field] !== undefined && signal[field] !== null);
}

/**
 * Type guard for checking if a value is a valid signal type
 */
export function isValidSignalType(value: any): value is 'buy' | 'sell' | 'neutral' {
  return value === 'buy' || value === 'sell' || value === 'neutral';
}

/**
 * Type guard for checking if a value is a valid timeframe
 */
export function isValidTimeframe(value: any): value is string {
  const validTimeframes = ['5m', '15m', '1h', '1H', '4h', '4H', '1d', '1D'];
  return typeof value === 'string' && validTimeframes.includes(value);
}

/**
 * Normalize timeframe to lowercase format
 * Supports: 1m, 3m, 5m, 15m, 30m, 1h, 4h, 1d, 1w, 1mo
 */
export function normalizeTimeframe(timeframe: string): string {
  const map: Record<string, string> = {
    '1m': '1m',
    '1M': '1m',
    '3m': '3m',
    '3M': '3m',
    '5m': '5m',
    '5M': '5m',
    '15m': '15m',
    '15M': '15m',
    '30m': '30m',
    '30M': '30m',
    '1h': '1h',
    '1H': '1h',
    '4h': '4h',
    '4H': '4h',
    '1d': '1d',
    '1D': '1d',
    '1w': '1w',
    '1W': '1w',
    '1mo': '1mo',
    '1MO': '1mo',
  };
  return map[timeframe] || timeframe.toLowerCase();
}

/**
 * Determine trading style from timeframe (legacy helper).
 * NOTE: For new engine-aware flows, engine_type should be passed explicitly
 * and trading_style should be derived from that engine, not inferred here.
 */
export function determineTradingStyle(timeframe: string): 'daytrade' | 'swing' | 'invest' {
  const tf = timeframe.toLowerCase();
  if (tf === '5m' || tf === '15m' || tf === '1h') return 'daytrade';
  if (tf === '4h') return 'swing';
  return 'invest'; // 1d, 1w
}

export function tradingStyleFromEngine(engine: EngineType): 'daytrade' | 'swing' | 'invest' {
  switch (engine) {
    case 'DAYTRADER':
      return 'daytrade';
    case 'SWING':
      return 'swing';
    case 'INVESTOR':
    default:
      return 'invest';
  }
}

// ============================================================
// ENGINE-AWARE CONFIDENCE THRESHOLDS
// ============================================================

export type ConfidenceLevel = 'low' | 'moderate' | 'high' | 'strong';

/**
 * Get confidence level interpretation based on engine type
 * 
 * Different engines have different confidence thresholds:
 * - DAYTRADER: <30 Low, 30-49 Moderate, 50-69 High, ≥70 Strong
 * - SWING: <35 Low, 35-59 Moderate, 60-79 High, ≥80 Strong
 * - INVESTOR: <50 Low, 50-69 Moderate, 70-84 High, ≥85 Strong
 */
export function getConfidenceLevel(
  confidenceScore: number,
  engine: EngineType
): ConfidenceLevel {
  switch (engine) {
    case 'DAYTRADER':
      if (confidenceScore < 30) return 'low';
      if (confidenceScore < 50) return 'moderate';
      if (confidenceScore < 70) return 'high';
      return 'strong';

    case 'SWING':
      if (confidenceScore < 35) return 'low';
      if (confidenceScore < 60) return 'moderate';
      if (confidenceScore < 80) return 'high';
      return 'strong';

    case 'INVESTOR':
      if (confidenceScore < 50) return 'low';
      if (confidenceScore < 70) return 'moderate';
      if (confidenceScore < 85) return 'high';
      return 'strong';

    default:
      // Default to SWING thresholds
      if (confidenceScore < 35) return 'low';
      if (confidenceScore < 60) return 'moderate';
      if (confidenceScore < 80) return 'high';
      return 'strong';
  }
}

/**
 * Determine if signal should be generated based on confidence, risk, and engine tolerance
 * 
 * Returns true if signal meets minimum quality standards for the engine.
 * Considers both confidence score and risk level.
 */
export function shouldGenerateSignal(
  confidenceScore: number,
  riskScore: number,
  engine: EngineType
): boolean {
  // Check risk rejection first (engine-specific thresholds)
  switch (engine) {
    case 'DAYTRADER':
      // Accepts high risk, only rejects extreme >80
      if (riskScore > 80) return false;
      // Minimum confidence: 25
      return confidenceScore >= 25;

    case 'SWING':
      // Moderate risk tolerance, rejects >70
      if (riskScore > 70) return false;
      // Minimum confidence: 30
      return confidenceScore >= 30;

    case 'INVESTOR':
      // Low risk tolerance, rejects >50
      if (riskScore > 50) return false;
      // Minimum confidence: 45 (Investor needs high conviction)
      return confidenceScore >= 45;

    default:
      // Default to SWING standards
      if (riskScore > 70) return false;
      return confidenceScore >= 30;
  }
}

/**
 * Get minimum confidence threshold for an engine
 */
export function getMinimumConfidence(engine: EngineType): number {
  switch (engine) {
    case 'DAYTRADER':
      return 25;
    case 'SWING':
      return 30;
    case 'INVESTOR':
      return 45;
    default:
      return 30;
  }
}

/**
 * Get maximum acceptable risk for an engine
 */
export function getMaximumRisk(engine: EngineType): number {
  switch (engine) {
    case 'DAYTRADER':
      return 80;
    case 'SWING':
      return 70;
    case 'INVESTOR':
      return 50;
    default:
      return 70;
  }
}

/**
 * Hard safety rails for price plans.
 *
 * Prevents obviously nonsensical plans (negative stops, >100% risk, 5x targets, etc.)
 * from ever reaching ai_signals or the UI.
 */
export function isPricePlanSane(
  engine: EngineType,
  signalType: 'buy' | 'sell' | 'neutral',
  entry: number | null | undefined,
  stop: number | null | undefined,
  tp1: number | null | undefined,
): boolean {
  if (!entry || !stop || !tp1) return false;

  // Disallow negative or zero prices outright
  if (entry <= 0 || stop <= 0 || tp1 <= 0) return false;

  const isLong = signalType === 'buy';

  // Basic ordering constraints
  if (isLong) {
    // For longs: SL must be below entry, TP1 above entry
    if (!(stop < entry && tp1 > entry)) return false;
  } else {
    // For shorts: SL must be above entry, TP1 below entry
    if (!(stop > entry && tp1 < entry)) return false;
  }

  const riskPct = isLong
    ? (entry - stop) / entry
    : (stop - entry) / entry;
  const rewardPct = isLong
    ? (tp1 - entry) / entry
    : (entry - tp1) / entry;

  if (!Number.isFinite(riskPct) || !Number.isFinite(rewardPct)) return false;

  // Engine-specific caps (very conservative, can be tuned)
  let maxRiskPct: number;
  let maxRewardPct: number;

  switch (engine) {
    case 'DAYTRADER':
      maxRiskPct = 0.25; // max -25%
      maxRewardPct = 1.5; // max +150%
      break;
    case 'SWING':
      maxRiskPct = 0.35; // max -35%
      maxRewardPct = 2.0; // max +200%
      break;
    case 'INVESTOR':
    default:
      maxRiskPct = 0.40;
      maxRewardPct = 3.0;
      break;
  }

  if (riskPct <= 0 || riskPct > maxRiskPct) return false;
  if (rewardPct <= 0 || rewardPct > maxRewardPct) return false;

  return true;
}

// ============================================================
// BACKTEST TYPES
// ============================================================

/**
 * Backtest configuration per engine
 */
export interface BacktestConfig {
  engine_type: EngineType;
  symbol: string;
  timeframe: string;
  start_date: string; // ISO 8601
  end_date: string; // ISO 8601
  starting_equity: number; // Default: 100,000
  risk_per_trade_pct: number; // DAYTRADER: 1%, SWING: 1.5%, INVESTOR: 2%
  max_concurrent_positions: number; // DAYTRADER: 4, SWING: 3, INVESTOR: 2
}

/**
 * Individual trade result in backtest
 */
export interface BacktestTrade {
  entry_date: string;
  exit_date: string;
  direction: 'long' | 'short';
  entry_price: number;
  exit_price: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  position_size: number;
  r_value: number;
  r_multiple_achieved: number; // e.g. 2.0 = 2R gain
  exit_reason: 'sl' | 'tp1' | 'tp2' | 'manual';
  pnl: number; // Dollar P&L
  pnl_pct: number; // % return on position
  tp1_hit: boolean;
  tp2_hit: boolean;
  equity_after: number;
}

/**
 * Backtest results summary
 */
export interface BacktestResult {
  id?: string;
  engine_type: EngineType;
  symbol: string;
  timeframe: string;
  start_date: string;
  end_date: string;
  starting_equity: number;
  ending_equity: number;
  
  // Performance metrics
  total_return_pct: number;
  max_drawdown_pct: number;
  win_rate_pct: number;
  avg_r_per_trade: number;
  
  // Trade statistics
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  best_trade_r: number;
  worst_trade_r: number;
  
  // TP hit rates
  tp1_hit_rate_pct: number;
  tp2_hit_rate_pct: number;
  
  // Stored data
  equity_curve: Array<{
    date: string;
    equity: number;
  }>;
  trades: BacktestTrade[];
  
  // Metadata
  created_at?: string;
}

/**
 * Live position tracking (for backtest simulation)
 */
export interface Position {
  id: string;
  symbol: string;
  direction: 'long' | 'short';
  entry_date: string;
  entry_price: number;
  position_size: number;
  current_size: number; // Reduced after partial exits
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  r_value: number;
  tp1_hit: boolean;
  tp2_hit: boolean;
  status: 'open' | 'closed';
}
