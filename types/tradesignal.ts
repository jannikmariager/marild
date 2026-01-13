export type SignalDirection = 'bullish' | 'neutral' | 'bearish';
export type Timeframe = '15m' | '1H' | '4H' | '1D' | '1W';
export type TradingStyle = 'daytrade' | 'swing' | 'invest';

export interface OrderBlock {
  type: 'bullish' | 'bearish';
  priceHigh: number;
  priceLow: number;
  timestamp: string;
  status: 'active' | 'mitigated';
  origin: string;
}

export interface BreakOfStructure {
  direction: 'up' | 'down';
  price: number;
  timestamp: string;
  strength: number;
}

export interface SmartLevel {
  type: 'support' | 'resistance' | 'order_block';
  price: number;
  strength: number;
  description: string;
}

export interface AISignal {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  signal_type: SignalDirection;
  confidence_score: number;
  correction_risk: number;
  reasons?: {
    items: string[];
  };
  key_levels: SmartLevel[];
  order_blocks?: OrderBlock[];
  bos_events?: BreakOfStructure[];
  created_at: string;
  updated_at: string;
  is_manual_request: boolean;
  cached_source: boolean;
  engine_type?: 'DAYTRADER' | 'SWING' | 'INVESTOR';
  engine_version?: string | null;
  engine_key?: string | null;
  engine_style?: string | null;
}

export interface TradeSignalRequest {
  symbol: string;
  timeframe: Timeframe;
  trading_style?: TradingStyle;
}

export interface TradeSignalResponse {
  signal: AISignal;
  cached: boolean;
  ageMinutes: number;
  canManualRefresh?: boolean;
}

export interface TradeSetup {
  direction: SignalDirection;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  confidence: number;
  reasoning: string[];
  timeframe: Timeframe;
}

export interface SMCAnalysis {
  orderBlocks: OrderBlock[];
  bosEvents: BreakOfStructure[];
  aiSummary: string;
  tradeSetups: TradeSetup[];
}

// Helper functions for trading styles
export function getTradingStyleLabel(tradingStyle: TradingStyle): string {
  switch (tradingStyle) {
    case 'daytrade':
      return 'Daytrade';
    case 'swing':
      return 'Swing';
    case 'invest':
      return 'Investing';
    default:
      return 'Swing';
  }
}

export function getTradingStyleEmoji(tradingStyle: TradingStyle): string {
  switch (tradingStyle) {
    case 'daytrade':
      return '';
    case 'swing':
      return '';
    case 'invest':
      return '';
    default:
      return '';
  }
}

export function determineTradingStyle(timeframe: string): TradingStyle {
  const tf = timeframe.toLowerCase();
  if (tf === '5m' || tf === '15m' || tf === '1h') return 'daytrade';
  if (tf === '4h') return 'swing';
  return 'invest';
}
