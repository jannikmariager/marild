export interface ApprovedTicker {
  ticker: string;
  is_daytrader_enabled: boolean;
  is_swing_enabled: boolean;
  is_investing_enabled: boolean;
  segments: string[];
}

export type TickerSegment = 'DAYTRADER' | 'SWING' | 'INVESTING';
