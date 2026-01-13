// AI Feed API Response Types
// Mirrors Flutter models from lib/models/ai_feed_models.dart

export interface AccessControl {
  is_locked: boolean;
  reason?: string;
  message?: string;
}

export interface MarketMetrics {
  spy_change: number;
  vix_level: number;
  breadth: string;
}

export interface AiMarketSummary {
  summary: string;
  sentiment: 'bullish' | 'neutral' | 'bearish';
  key_points: string[];
  as_of_date: string;
  updated_at: string;
  cached: boolean;
  isLive: boolean;
  metrics?: MarketMetrics;
  access?: AccessControl;
}

export interface QuickAction {
  id: string;
  label: string;
  icon: string;
  category: 'analysis' | 'scan' | 'research';
  route?: string;
  description?: string;
}

export interface QuickActionsResponse {
  actions: QuickAction[];
  access?: AccessControl;
  cached: boolean;
  generated_at: string;
}

export interface TrendingSignal {
  symbol: string;
  signal_type: string;
  confidence_score?: number;
  timeframe: string;
  created_at: string;
  entry_price?: number;
  target_price?: number;
}

export interface TrendingSignalsResponse {
  signals: TrendingSignal[];
  access?: AccessControl & {
    locked_fields?: string[];
  };
  count: number;
  updated_at: string;
  cached: boolean;
  isLive: boolean;
  note?: string;
}

export interface SectorStrength {
  name: string;
  symbol: string;
  performance_1d: number;
  trend: 'up' | 'down' | 'neutral';
  icon: string;
  isLocked?: boolean;
}

export interface SectorStrengthResponse {
  sectors: SectorStrength[];
  access?: AccessControl;
  count: number;
  updated_at: string;
  cached: boolean;
  isLive: boolean;
  note?: string;
}
