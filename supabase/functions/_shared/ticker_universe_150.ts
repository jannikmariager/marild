/**
 * TradeLens 150-Ticker Universe
 * 
 * Curated list for 3-year historical download:
 * - SP500 Top 100 by weight
 * - NDX100 Top 100 (with overlap)
 * - High-Volatility stocks
 * - Leveraged ETFs
 * - Crypto proxies
 */

export const TICKER_UNIVERSE_150 = [
  // Mega Cap Tech (Top 20 by weight)
  'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'GOOGL', 'GOOG', 'TSLA', 'BRK.B', 'AVGO',
  'JPM', 'LLY', 'V', 'UNH', 'XOM', 'WMT', 'MA', 'ORCL', 'HD', 'PG',
  
  // Large Cap Tech & Growth (20)
  'NFLX', 'COST', 'ABBV', 'CRM', 'BAC', 'CVX', 'AMD', 'ADBE', 'PEP', 'KO',
  'MRK', 'TMO', 'CSCO', 'ACN', 'LIN', 'MCD', 'ABT', 'DIS', 'WFC', 'DHR',
  
  // Large Cap Diversified (20)
  'QCOM', 'GE', 'VZ', 'CMCSA', 'INTC', 'IBM', 'TXN', 'INTU', 'PM', 'UNP',
  'HON', 'RTX', 'NKE', 'AMGN', 'NEE', 'LOW', 'T', 'BA', 'CAT', 'BMY',
  
  // Mid Cap Growth & Value (20)
  'SBUX', 'GS', 'ISRG', 'AXP', 'SPGI', 'BLK', 'DE', 'LMT', 'BKNG', 'GILD',
  'MMM', 'ADI', 'TJX', 'CI', 'ZTS', 'MDLZ', 'AMT', 'REGN', 'PLD', 'CB',
  
  // Financial & Industrial (10)
  'SCHW', 'C', 'MS', 'USB', 'PNC', 'ADP', 'MU', 'SLB', 'BX', 'AMAT',
  
  // High-Volatility Stocks (20)
  'PLTR', 'COIN', 'RIVN', 'MARA', 'RIOT', 'MSTR', 'HUT', 'CLSK', 'NIO', 'LCID',
  'FSR', 'AFRM', 'SNAP', 'SQ', 'TTD', 'UPST', 'HOOD', 'SOFI', 'CELH', 'DKNG',
  
  // ETFs - Major Indices (10)
  'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'IVV', 'EEM', 'EFA', 'AGG',
  
  // ETFs - Leveraged (10)
  'TQQQ', 'SQQQ', 'SOXL', 'SOXS', 'UVXY', 'SPXL', 'SPXS', 'LABU', 'LABD', 'TNA',
  
  // ETFs - Sector & Thematic (10)
  'SMH', 'XLF', 'XLE', 'XLK', 'XLV', 'XLI', 'XLP', 'XLY', 'XLU', 'ARKK',
  
  // Crypto Proxies (10)
  'BITO', 'GBTC', 'IBIT', 'FBTC', 'BITB', 'IREN', 'BTDR', 'WULF', 'CIFR', 'CORZ'
];

// Remove duplicates and sort
export const UNIQUE_TICKERS = Array.from(new Set(TICKER_UNIVERSE_150)).sort();

console.log(`Ticker Universe: ${UNIQUE_TICKERS.length} unique symbols`);
