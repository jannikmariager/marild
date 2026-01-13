import type { BacktestEngineType as EngineType } from "./types_v4";

export type { EngineType };

export function getHorizonForEngine(engineType: EngineType): number {
  switch (engineType) {
    case "DAYTRADER":
      return 30; // 30 days for intraday DAYTRADER engines (1m/3m priority)
    case "SWING":
      return 180; // 180 days for 4h SWING engines
    case "INVESTOR":
      return 1095; // 3 years (1095 days) for 1d INVESTOR engines
    default:
      return 30;
  }
}
