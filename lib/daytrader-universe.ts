/**
 * DAYTRADER Ticker Universe Configuration
 * 
 * Defines the official trading universe for DAYTRADER engine with:
 * - Engine version routing (v3 vs v3.5)
 * - Enabled/disabled status per ticker
 * - Performance-based optimization
 */

export type DaytraderEngineVersion = 'V3' | 'V3_5';

export interface DaytraderTicker {
  ticker: string;
  engine_version: DaytraderEngineVersion;
  enabled: boolean;
  category: 'tech' | 'leveraged_etf' | 'growth' | 'blue_chip' | 'index';
  description: string;
}

/**
 * Official DAYTRADER Trading Universe
 * Based on 30-day backtested performance (Dec 2024)
 */
export const DAYTRADER_UNIVERSE: DaytraderTicker[] = [
  // V3.5 SPECIALIST ENGINE (10 enabled tickers)
  {
    ticker: 'MSFT',
    engine_version: 'V3_5',
    enabled: true,
    category: 'tech',
    description: 'Microsoft - v3.5 optimized (+0.061 avgR vs v3)',
  },
  {
    ticker: 'NFLX',
    engine_version: 'V3_5',
    enabled: true,
    category: 'tech',
    description: 'Netflix - v3.5 best performer (+0.207 avgR vs v3)',
  },
  {
    ticker: 'PLTR',
    engine_version: 'V3_5',
    enabled: true,
    category: 'growth',
    description: 'Palantir - v3.5 optimized (+0.188 avgR vs v3)',
  },
  {
    ticker: 'SPY',
    engine_version: 'V3_5',
    enabled: true,
    category: 'index',
    description: 'S&P 500 ETF - v3.5 tuned (+0.153 avgR vs v3)',
  },
  {
    ticker: 'SOXL',
    engine_version: 'V3_5',
    enabled: true,
    category: 'leveraged_etf',
    description: 'Semiconductor 3x Bull - v3.5 optimized (+0.102 avgR)',
  },
  {
    ticker: 'NVDA',
    engine_version: 'V3_5',
    enabled: true,
    category: 'tech',
    description: 'NVIDIA - v3.5 optimized (+0.059 avgR vs v3)',
  },
  {
    ticker: 'AMD',
    engine_version: 'V3_5',
    enabled: true,
    category: 'tech',
    description: 'AMD - v3.5 optimized (+0.156 avgR vs v3)',
  },
  {
    ticker: 'AMZN',
    engine_version: 'V3_5',
    enabled: true,
    category: 'tech',
    description: 'Amazon - v3.5 optimized (+0.070 avgR vs v3)',
  },
  {
    ticker: 'JNJ',
    engine_version: 'V3_5',
    enabled: true,
    category: 'blue_chip',
    description: 'Johnson & Johnson - v3.5 stable (+0.089 avgR)',
  },
  {
    ticker: 'PG',
    engine_version: 'V3_5',
    enabled: true,
    category: 'blue_chip',
    description: 'Procter & Gamble - v3.5 defensive',
  },

  // V3 GENERALIST ENGINE (7 enabled tickers)
  {
    ticker: 'AAPL',
    engine_version: 'V3',
    enabled: true,
    category: 'tech',
    description: 'Apple - v3 superior (+0.109 avgR vs v3.5 -0.034)',
  },
  {
    ticker: 'TQQQ',
    engine_version: 'V3',
    enabled: true,
    category: 'leveraged_etf',
    description: 'Nasdaq 3x Bull - v3 superior (+0.108 avgR)',
  },
  {
    ticker: 'RIVN',
    engine_version: 'V3',
    enabled: true,
    category: 'growth',
    description: 'Rivian - v3 superior (+0.167 avgR)',
  },
  {
    ticker: 'KO',
    engine_version: 'V3',
    enabled: true,
    category: 'blue_chip',
    description: 'Coca-Cola - v3 defensive (+0.062 avgR)',
  },
  {
    ticker: 'QQQ',
    engine_version: 'V3',
    enabled: true,
    category: 'index',
    description: 'Nasdaq 100 ETF - v3 superior (+0.113 avgR)',
  },
  {
    ticker: 'TSLA',
    engine_version: 'V3',
    enabled: true,
    category: 'growth',
    description: 'Tesla - v3 preferred (-0.147 avgR)',
  },
  {
    ticker: 'XOM',
    engine_version: 'V3',
    enabled: true,
    category: 'blue_chip',
    description: 'Exxon Mobil - v3 energy (+0.164 avgR)',
  },

  // DISABLED TICKERS (Poor historical performance)
  {
    ticker: 'META',
    engine_version: 'V3',
    enabled: false,
    category: 'tech',
    description: 'Meta - DISABLED (poor performance: -0.424 avgR)',
  },
  {
    ticker: 'COIN',
    engine_version: 'V3',
    enabled: false,
    category: 'growth',
    description: 'Coinbase - DISABLED (poor performance: -0.308 avgR)',
  },
  {
    ticker: 'IWM',
    engine_version: 'V3_5',
    enabled: false,
    category: 'index',
    description: 'Russell 2000 ETF - DISABLED (poor performance: -0.200 avgR)',
  },
];

/**
 * Get enabled tickers only
 */
export function getEnabledTickers(): DaytraderTicker[] {
  return DAYTRADER_UNIVERSE.filter(t => t.enabled);
}

/**
 * Get tickers by engine version
 */
export function getTickersByEngine(version: DaytraderEngineVersion): DaytraderTicker[] {
  return DAYTRADER_UNIVERSE.filter(t => t.engine_version === version && t.enabled);
}

/**
 * Get engine version for a specific ticker
 */
export function getEngineVersion(ticker: string): DaytraderEngineVersion | null {
  const config = DAYTRADER_UNIVERSE.find(t => t.ticker === ticker.toUpperCase());
  if (!config || !config.enabled) return null;
  return config.engine_version;
}

/**
 * Check if ticker is enabled
 */
export function isTickerEnabled(ticker: string): boolean {
  const config = DAYTRADER_UNIVERSE.find(t => t.ticker === ticker.toUpperCase());
  return config?.enabled ?? false;
}

/**
 * Get ticker display name with engine badge
 */
export function getTickerDisplayName(ticker: string): string {
  const config = DAYTRADER_UNIVERSE.find(t => t.ticker === ticker.toUpperCase());
  if (!config) return ticker;
  
  const engineBadge = config.engine_version === 'V3' ? 'v3' : 'v3.5';
  return `${ticker} (${engineBadge})`;
}

/**
 * Get disabled tickers list
 */
export function getDisabledTickers(): string[] {
  return DAYTRADER_UNIVERSE.filter(t => !t.enabled).map(t => t.ticker);
}
