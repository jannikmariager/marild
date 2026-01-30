import type { CryptoBar, CryptoQuote } from '../../alpaca_crypto.ts';
import type { CryptoShadowConfig } from '../../config.ts';

export interface EngineContext {
  engineKey: 'CRYPTO_V1_SHADOW';
  engineVersion: 'v1';
  nowUtc: Date;
  config: CryptoShadowConfig;
}

export interface SignalContext {
  symbol: string;
  timeframe: string;
  bars: CryptoBar[];
  latestQuote: CryptoQuote | null;
}

export interface RuleDecision {
  decision: 'ENTRY' | 'NO_TRADE';
  side?: 'long' | 'short';
  entry?: number;
  stop?: number;
  tp1?: number;
  tp2?: number;
  reason_codes: string[];
  summary: string;
  explain: string[];
  atr?: number;
  swingStop?: number;
}

export interface PositionRow {
  id: string;
  engine_key: string;
  version: string;
  portfolio_id: string;
  symbol: string;
  side: 'long' | 'short';
  qty: number;
  avg_entry_price: number;
  stop_loss: number | null;
  take_profit1: number | null;
  take_profit2: number | null;
  realized_pnl: number;
  unrealized_pnl: number;
  status: 'open' | 'closed';
  opened_at: string;
  closed_at: string | null;
  meta: any;
}

export interface PortfolioRow {
  id: string;
  engine_key: string;
  engine_version: string;
  run_mode: string;
  starting_equity: number;
  equity: number;
  allocated_notional?: number;
  asset_class?: string;
  base_currency?: string;
}

export interface SizingResult {
  qty: number;
  notional: number;
  riskUsd: number;
  R: number;
}

export interface DecisionLogPayload {
  engine_key: string;
  version: string;
  symbol: string;
  timeframe: string;
  ts: string;
  signal: unknown;
  decision: unknown;
}
