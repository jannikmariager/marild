// Correction Risk Engine - Multi-factor market correction risk analysis
// Computes daily risk scores from market structure, volume, volatility, sentiment, macro, etc.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ==================== TYPES ====================

export interface CorrectionRiskSnapshot {
  id?: string;
  as_of_date: string; // YYYY-MM-DD
  risk_score: number; // 0-100
  risk_label: "low" | "moderate" | "high" | "critical";
  summary: string;
  created_at?: string;
  updated_at?: string;
}

export interface CorrectionRiskFactor {
  id?: string;
  snapshot_id?: string;
  factor_key: string;
  factor_label: string;
  score: number; // 0-1
  weight: number; // 0-1
  contribution: number; // score * weight
  status: "supportive" | "neutral" | "elevated" | "critical";
  reasoning: string;
  raw_data_snapshot: Record<string, any>;
  created_at?: string;
}

export interface MarketData {
  spx: { price: number; change: number; sma200: number; volume: number };
  nasdaq: { price: number; change: number };
  vix: number;
  advancers: number;
  decliners: number;
}

export interface NewsData {
  headlines: Array<{ title: string; description?: string }>;
}

export interface MacroData {
  inflationTrend: "rising" | "falling" | "stable";
  ratesTrend: "rising" | "falling" | "stable";
}

// ==================== FACTOR WEIGHTS ====================

export const FACTOR_WEIGHTS = {
  market_structure: 0.20,
  volume_pressure: 0.15,
  volatility: 0.15,
  news_sentiment: 0.20,
  macro: 0.10,
  sector_rotation: 0.10,
  breadth: 0.05,
  pattern_similarity: 0.03,
  geopolitical_risk: 0.02,
};

// ==================== DATA FETCHING ====================

export async function fetchMarketData(): Promise<MarketData> {
  // Fetch S&P 500, Nasdaq, VIX, breadth metrics
  // Using existing Finnhub/FMP APIs or Yahoo Finance
  const finnhubKey = Deno.env.get("FINNHUB_API_KEY");
  
  try {
    // Fetch S&P 500 quote
    const spxRes = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=^GSPC&token=${finnhubKey}`
    );
    const spxData = await spxRes.json();
    
    // Fetch VIX
    const vixRes = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=^VIX&token=${finnhubKey}`
    );
    const vixData = await vixRes.json();
    
    // Calculate simple moving average proxy (would need historical data in production)
    const sma200 = spxData.c * 0.98; // Simplified proxy - below price indicates bearish
    
    return {
      spx: {
        price: spxData.c || 4500,
        change: spxData.dp || 0,
        sma200,
        volume: spxData.v || 1000000,
      },
      nasdaq: {
        price: 15000, // Simplified
        change: 0,
      },
      vix: vixData.c || 15,
      advancers: 1500, // Simplified - would fetch from market breadth API
      decliners: 1500,
    };
  } catch (error) {
    console.error("Market data fetch error:", error);
    // Return neutral defaults
    return {
      spx: { price: 4500, change: 0, sma200: 4500, volume: 1000000 },
      nasdaq: { price: 15000, change: 0 },
      vix: 15,
      advancers: 1500,
      decliners: 1500,
    };
  }
}

export async function fetchNewsData(): Promise<NewsData> {
  // Fetch recent market news headlines
  const finnhubKey = Deno.env.get("FINNHUB_API_KEY");
  
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/news?category=general&token=${finnhubKey}`
    );
    const data = await res.json();
    
    return {
      headlines: data.slice(0, 20).map((item: any) => ({
        title: item.headline || "",
        description: item.summary || "",
      })),
    };
  } catch (error) {
    console.error("News data fetch error:", error);
    return { headlines: [] };
  }
}

export async function fetchMacroData(): Promise<MacroData> {
  // Simplified macro analysis - in production would fetch FRED API
  // For now, return neutral defaults
  return {
    inflationTrend: "stable",
    ratesTrend: "stable",
  };
}

// ==================== FACTOR SCORING FUNCTIONS ====================

export function scoreMarketStructure(market: MarketData): {
  score: number;
  reasoning: string;
  rawData: Record<string, any>;
} {
  let score = 0;
  const reasons: string[] = [];
  
  // Check if price below SMA200
  if (market.spx.price < market.spx.sma200) {
    score += 0.4;
    reasons.push("Price below 200-day moving average");
  }
  
  // Check recent trend
  if (market.spx.change < -1) {
    score += 0.3;
    reasons.push("Recent negative momentum");
  } else if (market.spx.change < -2) {
    score += 0.3;
    reasons.push("Significant downward pressure");
  }
  
  return {
    score: Math.min(score, 1),
    reasoning:
      reasons.length > 0
        ? reasons.join("; ") + "."
        : "Price structure stable with support holding.",
    rawData: {
      price: market.spx.price,
      sma200: market.spx.sma200,
      change: market.spx.change,
    },
  };
}

export function scoreVolumePressure(market: MarketData): {
  score: number;
  reasoning: string;
  rawData: Record<string, any>;
} {
  // Analyze volume patterns - simplified
  const avgVolume = 1000000; // Would calculate from historical data
  const volumeRatio = market.spx.volume / avgVolume;
  
  let score = 0;
  if (volumeRatio > 1.5 && market.spx.change < 0) {
    score = 0.7;
  } else if (volumeRatio > 1.2 && market.spx.change < 0) {
    score = 0.4;
  } else {
    score = 0.2;
  }
  
  return {
    score,
    reasoning:
      score > 0.5
        ? "Elevated selling volume indicates distribution pressure."
        : "Volume patterns show normal trading activity.",
    rawData: { volume: market.spx.volume, volumeRatio },
  };
}

export function scoreVolatility(market: MarketData): {
  score: number;
  reasoning: string;
  rawData: Record<string, any>;
} {
  // Normalize VIX: 12-15 = low, 20-25 = elevated, 30+ = high
  const vix = market.vix;
  let score = 0;
  
  if (vix < 15) {
    score = 0.1;
  } else if (vix < 20) {
    score = 0.3;
  } else if (vix < 25) {
    score = 0.6;
  } else if (vix < 30) {
    score = 0.8;
  } else {
    score = 1.0;
  }
  
  return {
    score,
    reasoning:
      vix > 25
        ? `VIX at ${vix.toFixed(1)} indicates elevated fear and uncertainty.`
        : vix > 20
        ? `VIX at ${vix.toFixed(1)} shows moderate volatility concerns.`
        : `VIX at ${vix.toFixed(1)} indicates calm market conditions.`,
    rawData: { vix },
  };
}

export function scoreNewsSentiment(news: NewsData): {
  score: number;
  reasoning: string;
  rawData: Record<string, any>;
} {
  // Simple keyword-based sentiment
  const negativeKeywords = [
    "crash",
    "plunge",
    "sell-off",
    "decline",
    "losses",
    "bearish",
    "warning",
    "recession",
    "crisis",
    "turmoil",
  ];
  
  let negativeCount = 0;
  const allText =
    news.headlines.map((h) => h.title + " " + (h.description || "")).join(" ").toLowerCase();
  
  negativeKeywords.forEach((keyword) => {
    if (allText.includes(keyword)) negativeCount++;
  });
  
  const score = Math.min(negativeCount / 10, 1); // Normalize
  
  return {
    score,
    reasoning:
      score > 0.5
        ? "News sentiment is predominantly negative with bearish themes."
        : score > 0.3
        ? "News sentiment shows mixed signals with some concern."
        : "News sentiment is neutral to positive.",
    rawData: { negativeCount, totalHeadlines: news.headlines.length },
  };
}

export function scoreMacro(macro: MacroData): {
  score: number;
  reasoning: string;
  rawData: Record<string, any>;
} {
  let score = 0;
  const reasons: string[] = [];
  
  if (macro.inflationTrend === "rising") {
    score += 0.3;
    reasons.push("Rising inflation pressures");
  }
  
  if (macro.ratesTrend === "rising") {
    score += 0.4;
    reasons.push("Rising interest rates impact valuations");
  }
  
  return {
    score,
    reasoning:
      reasons.length > 0
        ? reasons.join("; ") + "."
        : "Macro environment stable with no major headwinds.",
    rawData: macro,
  };
}

export function scoreSectorRotation(market: MarketData): {
  score: number;
  reasoning: string;
  rawData: Record<string, any>;
} {
  // Simplified - would compare defensive vs growth sector performance
  // For now, use market breadth as proxy
  const score = market.spx.change < -1 ? 0.5 : 0.2;
  
  return {
    score,
    reasoning:
      score > 0.4
        ? "Defensive sector rotation signals risk-off positioning."
        : "Sector allocation remains balanced.",
    rawData: { marketChange: market.spx.change },
  };
}

export function scoreBreadth(market: MarketData): {
  score: number;
  reasoning: string;
  rawData: Record<string, any>;
} {
  const advanceDeclineRatio = market.advancers / (market.decliners || 1);
  let score = 0;
  
  if (advanceDeclineRatio < 0.5) {
    score = 0.8;
  } else if (advanceDeclineRatio < 0.8) {
    score = 0.5;
  } else if (advanceDeclineRatio < 1.2) {
    score = 0.3;
  } else {
    score = 0.1;
  }
  
  return {
    score,
    reasoning:
      score > 0.6
        ? "Narrow market breadth with declining participation."
        : "Market breadth shows healthy participation.",
    rawData: { advancers: market.advancers, decliners: market.decliners, ratio: advanceDeclineRatio },
  };
}

export function scorePatternSimilarity(
  marketScore: number,
  volumeScore: number,
  volatilityScore: number
): {
  score: number;
  reasoning: string;
  rawData: Record<string, any>;
} {
  // If multiple factors elevated simultaneously, pattern similar to correction regimes
  const elevatedCount = [marketScore, volumeScore, volatilityScore].filter(
    (s) => s > 0.6
  ).length;
  
  const score = elevatedCount >= 2 ? 0.8 : elevatedCount === 1 ? 0.4 : 0.1;
  
  return {
    score,
    reasoning:
      score > 0.6
        ? "Multiple risk factors align with historical correction patterns."
        : "Current market regime differs from typical correction setups.",
    rawData: { elevatedCount },
  };
}

export function scoreGeopoliticalRisk(news: NewsData): {
  score: number;
  reasoning: string;
  rawData: Record<string, any>;
} {
  const riskKeywords = [
    "war",
    "conflict",
    "sanctions",
    "escalation",
    "tensions",
    "military",
    "geopolitical",
  ];
  
  let riskCount = 0;
  const allText =
    news.headlines.map((h) => h.title + " " + (h.description || "")).join(" ").toLowerCase();
  
  riskKeywords.forEach((keyword) => {
    if (allText.includes(keyword)) riskCount++;
  });
  
  const score = Math.min(riskCount / 5, 1);
  
  return {
    score,
    reasoning:
      score > 0.5
        ? "Heightened geopolitical tensions present market risks."
        : "No significant geopolitical concerns.",
    rawData: { riskCount },
  };
}

// ==================== AGGREGATION & LABEL ====================

export function computeOverallRisk(factors: CorrectionRiskFactor[]): number {
  const totalRisk = factors.reduce((sum, f) => sum + f.contribution, 0);
  return Math.round(totalRisk * 100); // Scale to 0-100
}

export function getRiskLabel(
  score: number
): "low" | "moderate" | "high" | "critical" {
  if (score <= 30) return "low";
  if (score <= 60) return "moderate";
  if (score <= 85) return "high";
  return "critical";
}

export function getFactorStatus(
  score: number
): "supportive" | "neutral" | "elevated" | "critical" {
  if (score < 0.3) return "supportive";
  if (score < 0.6) return "neutral";
  if (score < 0.8) return "elevated";
  return "critical";
}

export function generateRiskSummary(
  riskScore: number,
  factors: CorrectionRiskFactor[]
): string {
  const label = getRiskLabel(riskScore);
  const topFactors = factors
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
    .map((f) => f.factor_label.toLowerCase());
  
  if (label === "low") {
    return `Correction risk is low: market structure is stable, volatility is contained, and sentiment remains balanced.`;
  } else if (label === "moderate") {
    return `Correction risk is moderate with some caution warranted. Key concerns: ${topFactors.join(", ")}.`;
  } else if (label === "high") {
    return `Correction risk is elevated due to ${topFactors.join(", ")}. Multiple warning signals present.`;
  } else {
    return `Correction risk is critical with severe warnings from ${topFactors.join(", ")}. Exercise extreme caution.`;
  }
}

// ==================== PERSISTENCE ====================

export async function saveRiskSnapshot(
  snapshot: CorrectionRiskSnapshot,
  factors: CorrectionRiskFactor[]
): Promise<{ snapshotId: string }> {
  // Insert snapshot
  const { data: snapshotData, error: snapshotError } = await supabase
    .from("correction_risk_snapshots")
    .insert({
      as_of_date: snapshot.as_of_date,
      risk_score: snapshot.risk_score,
      risk_label: snapshot.risk_label,
      summary: snapshot.summary,
    })
    .select()
    .single();
  
  if (snapshotError) {
    throw new Error(`Failed to save snapshot: ${snapshotError.message}`);
  }
  
  const snapshotId = snapshotData.id;
  
  // Insert factors
  const factorsToInsert = factors.map((f) => ({
    snapshot_id: snapshotId,
    factor_key: f.factor_key,
    factor_label: f.factor_label,
    score: f.score,
    weight: f.weight,
    contribution: f.contribution,
    status: f.status,
    reasoning: f.reasoning,
    raw_data_snapshot: f.raw_data_snapshot,
  }));
  
  const { error: factorsError } = await supabase
    .from("correction_risk_factors")
    .insert(factorsToInsert);
  
  if (factorsError) {
    throw new Error(`Failed to save factors: ${factorsError.message}`);
  }
  
  return { snapshotId };
}

// ==================== MAIN COMPUTATION PIPELINE ====================

export async function computeCorrectionRisk(): Promise<{
  snapshot: CorrectionRiskSnapshot;
  factors: CorrectionRiskFactor[];
}> {
  console.log("Starting correction risk computation...");
  
  // Fetch data
  const market = await fetchMarketData();
  const news = await fetchNewsData();
  const macro = await fetchMacroData();
  
  console.log("Data fetched:", { market, newsCount: news.headlines.length, macro });
  
  // Compute factor scores
  const marketStructure = scoreMarketStructure(market);
  const volumePressure = scoreVolumePressure(market);
  const volatility = scoreVolatility(market);
  const newsSentiment = scoreNewsSentiment(news);
  const macroScore = scoreMacro(macro);
  const sectorRotation = scoreSectorRotation(market);
  const breadth = scoreBreadth(market);
  const patternSimilarity = scorePatternSimilarity(
    marketStructure.score,
    volumePressure.score,
    volatility.score
  );
  const geopoliticalRisk = scoreGeopoliticalRisk(news);
  
  // Build factors array
  const factors: CorrectionRiskFactor[] = [
    {
      factor_key: "market_structure",
      factor_label: "Market structure",
      score: marketStructure.score,
      weight: FACTOR_WEIGHTS.market_structure,
      contribution: marketStructure.score * FACTOR_WEIGHTS.market_structure,
      status: getFactorStatus(marketStructure.score),
      reasoning: marketStructure.reasoning,
      raw_data_snapshot: marketStructure.rawData,
    },
    {
      factor_key: "volume_pressure",
      factor_label: "Volume pressure",
      score: volumePressure.score,
      weight: FACTOR_WEIGHTS.volume_pressure,
      contribution: volumePressure.score * FACTOR_WEIGHTS.volume_pressure,
      status: getFactorStatus(volumePressure.score),
      reasoning: volumePressure.reasoning,
      raw_data_snapshot: volumePressure.rawData,
    },
    {
      factor_key: "volatility",
      factor_label: "Volatility",
      score: volatility.score,
      weight: FACTOR_WEIGHTS.volatility,
      contribution: volatility.score * FACTOR_WEIGHTS.volatility,
      status: getFactorStatus(volatility.score),
      reasoning: volatility.reasoning,
      raw_data_snapshot: volatility.rawData,
    },
    {
      factor_key: "news_sentiment",
      factor_label: "News sentiment",
      score: newsSentiment.score,
      weight: FACTOR_WEIGHTS.news_sentiment,
      contribution: newsSentiment.score * FACTOR_WEIGHTS.news_sentiment,
      status: getFactorStatus(newsSentiment.score),
      reasoning: newsSentiment.reasoning,
      raw_data_snapshot: newsSentiment.rawData,
    },
    {
      factor_key: "macro",
      factor_label: "Macro environment",
      score: macroScore.score,
      weight: FACTOR_WEIGHTS.macro,
      contribution: macroScore.score * FACTOR_WEIGHTS.macro,
      status: getFactorStatus(macroScore.score),
      reasoning: macroScore.reasoning,
      raw_data_snapshot: macroScore.rawData,
    },
    {
      factor_key: "sector_rotation",
      factor_label: "Sector rotation",
      score: sectorRotation.score,
      weight: FACTOR_WEIGHTS.sector_rotation,
      contribution: sectorRotation.score * FACTOR_WEIGHTS.sector_rotation,
      status: getFactorStatus(sectorRotation.score),
      reasoning: sectorRotation.reasoning,
      raw_data_snapshot: sectorRotation.rawData,
    },
    {
      factor_key: "breadth",
      factor_label: "Market breadth",
      score: breadth.score,
      weight: FACTOR_WEIGHTS.breadth,
      contribution: breadth.score * FACTOR_WEIGHTS.breadth,
      status: getFactorStatus(breadth.score),
      reasoning: breadth.reasoning,
      raw_data_snapshot: breadth.rawData,
    },
    {
      factor_key: "pattern_similarity",
      factor_label: "Pattern similarity",
      score: patternSimilarity.score,
      weight: FACTOR_WEIGHTS.pattern_similarity,
      contribution: patternSimilarity.score * FACTOR_WEIGHTS.pattern_similarity,
      status: getFactorStatus(patternSimilarity.score),
      reasoning: patternSimilarity.reasoning,
      raw_data_snapshot: patternSimilarity.rawData,
    },
    {
      factor_key: "geopolitical_risk",
      factor_label: "Geopolitical risk",
      score: geopoliticalRisk.score,
      weight: FACTOR_WEIGHTS.geopolitical_risk,
      contribution: geopoliticalRisk.score * FACTOR_WEIGHTS.geopolitical_risk,
      status: getFactorStatus(geopoliticalRisk.score),
      reasoning: geopoliticalRisk.reasoning,
      raw_data_snapshot: geopoliticalRisk.rawData,
    },
  ];
  
  // Compute overall risk
  const riskScore = computeOverallRisk(factors);
  const riskLabel = getRiskLabel(riskScore);
  const summary = generateRiskSummary(riskScore, factors);
  
  const snapshot: CorrectionRiskSnapshot = {
    as_of_date: new Date().toISOString().split("T")[0],
    risk_score: riskScore,
    risk_label: riskLabel,
    summary,
  };
  
  console.log("Correction risk computed:", { riskScore, riskLabel });
  
  return { snapshot, factors };
}
