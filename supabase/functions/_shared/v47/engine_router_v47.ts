import { loadUnifiedOHLC, type SupportedTimeframe } from "../ohlc_loader.ts";
import type { EngineType, OHLCBar } from "../signal_types.ts";
import { computeHtfBias, DEFAULT_V47_HTF_CONFIG } from "../backtest/v4_7/htf_alignment_v4_7.ts";
import { runEngineV47, type EngineV47Result } from "./engine_v47.ts";

export interface EngineV47Config {
  symbol: string;
  engineType: EngineType;
  timeframe: SupportedTimeframe;
  horizonDays?: number;
}

function engineTypeToProfileKey(engineType: EngineType): keyof typeof DEFAULT_V47_HTF_CONFIG {
  switch (engineType) {
    case "DAYTRADER":
      return "daytrader";
    case "SWING":
      return "swing";
    case "INVESTOR":
    default:
      return "investor";
  }
}

export async function runBacktestV47(config: EngineV47Config): Promise<EngineV47Result> {
  const { symbol, engineType, timeframe, horizonDays } = config;

  const bars: OHLCBar[] = await loadUnifiedOHLC(symbol, timeframe, horizonDays);
  if (!bars || bars.length === 0) {
    return runEngineV47({
      symbol,
      timeframe,
      engineType,
      bars: [],
      htfBiasOverall: "neutral",
    });
  }

  const profileKey = engineTypeToProfileKey(engineType);
  const htfProfile = DEFAULT_V47_HTF_CONFIG[profileKey];

  let htfBias: "bullish" | "bearish" | "neutral" = "neutral";
  try {
    const htfBars = await loadUnifiedOHLC(symbol, htfProfile.timeframe as SupportedTimeframe);
    if (htfBars && htfBars.length > 0) {
      htfBias = computeHtfBias(htfBars, htfProfile);
    }
  } catch (err) {
    console.warn(
      "[engine_router_v47] Failed to load HTF bars for",
      symbol,
      engineType,
      (err as Error)?.message ?? String(err),
    );
  }

  return runEngineV47({
    symbol,
    timeframe,
    engineType,
    bars,
    htfBiasOverall: htfBias,
  });
}
