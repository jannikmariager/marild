export const mockPortfolioData = {
  todayPnL: 2847.32,
  winRate: 68.5,
  openPositions: 7,
  daytrade: {
    equity: 47832.45,
    return: 12.4,
    trades: 142,
  },
  swing: {
    equity: 93421.18,
    return: 18.7,
    trades: 89,
  },
  combined: {
    winRate90d: 71.2,
    maxDrawdown: -8.4,
    sharpeScore: 1.84,
  },
};

// Seeded random for stable SSR/client rendering
const seededRandom = (seed: number) => {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
};

export const mockEquityCurve = Array.from({ length: 90 }, (_, i) => ({
  day: i,
  equity: 40000 + seededRandom(i * 1.5) * 5000 + i * 600,
  spy: 40000 + seededRandom(i * 2.3) * 3000 + i * 400,
}));

export const mock24HourSparkline = Array.from({ length: 24 }, (_, i) => ({
  hour: i,
  value: 45000 + seededRandom(i * 3.7) * 2000,
}));

export const mockSignals = [
  {
    id: 1,
    ticker: "AAPL",
    confidence: 87,
    smcAlignment: "Bullish OB",
    trendContext: "Uptrend",
    entry: 178.45,
    sl: 175.20,
    tp1: 182.30,
    tp2: 186.50,
    volumeConfirmation: true,
    marketRisk: "Low",
  },
  {
    id: 2,
    ticker: "TSLA",
    confidence: 92,
    smcAlignment: "FVG Fill",
    trendContext: "Range",
    entry: 242.80,
    sl: 238.50,
    tp1: 248.20,
    tp2: 253.90,
    volumeConfirmation: true,
    marketRisk: "Medium",
  },
  {
    id: 3,
    ticker: "NVDA",
    confidence: 78,
    smcAlignment: "Liquidity Sweep",
    trendContext: "Uptrend",
    entry: 495.30,
    sl: 488.10,
    tp1: 505.80,
    tp2: 516.20,
    volumeConfirmation: true,
    marketRisk: "Low",
  },
  {
    id: 4,
    ticker: "MSFT",
    confidence: 85,
    smcAlignment: "MSS Confirmed",
    trendContext: "Uptrend",
    entry: 378.90,
    sl: 374.20,
    tp1: 385.40,
    tp2: 391.80,
    volumeConfirmation: true,
    marketRisk: "Low",
  },
  {
    id: 5,
    ticker: "AMD",
    confidence: 73,
    smcAlignment: "Bearish OB",
    trendContext: "Downtrend",
    entry: 142.60,
    sl: 145.90,
    tp1: 138.20,
    tp2: 134.50,
    volumeConfirmation: false,
    marketRisk: "Medium",
  },
  {
    id: 6,
    ticker: "META",
    confidence: 89,
    smcAlignment: "FVG + OB",
    trendContext: "Uptrend",
    entry: 412.35,
    sl: 406.80,
    tp1: 420.90,
    tp2: 428.50,
    volumeConfirmation: true,
    marketRisk: "Low",
  },
];

export const smcFeatures = [
  {
    title: "Order Blocks",
    description: "Institutional accumulation/distribution zones",
    icon: "📊",
  },
  {
    title: "Liquidity Zones",
    description: "Where smart money hunts stop losses",
    icon: "💧",
  },
  {
    title: "Fair Value Gaps",
    description: "Imbalance zones for retracement entries",
    icon: "📈",
  },
  {
    title: "Displacement & MSS",
    description: "Momentum shifts and market structure breaks",
    icon: "⚡",
  },
  {
    title: "Volume Clusters",
    description: "High-conviction institutional activity",
    icon: "📉",
  },
  {
    title: "Regime Detection",
    description: "Trend, range, or volatile market classification",
    icon: "🎯",
  },
];

export const educationalSlides = [
  {
    title: "Position Sizing Rules",
    content: [
      "Max 20% notional per position",
      "Total portfolio exposure capped at 80%",
      "Risk-adjusted sizing based on volatility",
      "Never exceed 2% risk per trade",
    ],
  },
  {
    title: "Trade Lifecycle",
    content: [
      "Signal generated with full SMC context",
      "Entry, SL, TP1, TP2 structure defined",
      "Position tracked in real-time",
      "P&L recorded and benchmarked",
    ],
  },
  {
    title: "Risk Model",
    content: [
      "Daily market regime classification",
      "Volatility-based signal filtering",
      "Drawdown protection mechanisms",
      "Multi-factor risk scoring (0-100)",
    ],
  },
  {
    title: "Why This Matters",
    content: [
      "We trade with rules so you don't have to guess",
      "Every trade is documented and auditable",
      "Losses are part of the system, not failures",
      "Transparency builds trust and confidence",
    ],
  },
];
