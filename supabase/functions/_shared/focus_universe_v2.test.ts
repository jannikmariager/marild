import { buildFocusUniverseV2 } from "./focus_universe_v2.ts";
import type { FocusConfig } from "./config.ts";

const mockSignals = [
  { id: "s1", symbol: "AAPL", confidence_score: 60, created_at: new Date().toISOString() },
  { id: "s2", symbol: "MARA", confidence_score: 50, created_at: new Date().toISOString() },
  { id: "s3", symbol: "NIO", confidence_score: 53, created_at: new Date().toISOString() },
  { id: "s4", symbol: "KO", confidence_score: 40, created_at: new Date().toISOString() },
];

const mockSupabase: any = {
  from: (_table: string) => ({
    select: () => ({
      in: () => ({
        gte: () => ({
          order: () => ({ data: mockSignals, error: null }),
        }),
      }),
    }),
  }),
};

const baseConfig: FocusConfig = {
  primaryMinConf: 55,
  momentumMinConf: 48,
  momentumMaxConf: 54,
  lookbackHours: 24,
  maxTickers: 30,
  minFocusSize: 3,
  missedListSize: 5,
  volatilityGateMode: "LIST",
  volatilityTickerList: ["MARA", "NIO"],
  atrPercentileMin: 0.7,
  atrLookbackDays: 14,
  enableDbAudit: false,
  enableVerboseLogs: false,
};

Deno.test("focus_universe_v2 builds lanes and preserves order", async () => {
  const res = await buildFocusUniverseV2({
    supabase: mockSupabase,
    universeTickers: ["AAPL", "MARA", "NIO", "KO"],
    config: baseConfig,
  });

  // AAPL should land in primary
  const primaryTickers = res.primary.map((p) => p.ticker);
  if (!primaryTickers.includes("AAPL")) {
    throw new Error("AAPL not in primary");
  }

  // MARA/NIO should pass momentum via list gate
  const momentumTickers = res.momentum.map((m) => m.ticker);
  if (!momentumTickers.includes("MARA") || !momentumTickers.includes("NIO")) {
    throw new Error("Momentum tickers missing");
  }

  // Fallback should include KO to reach minFocusSize
  if (!res.fallback.map((f) => f.ticker).includes("KO")) {
    throw new Error("Fallback did not include KO");
  }

  // Final ordering: primary then momentum then fallback
  const aaplIndex = res.final.indexOf("AAPL");
  const maraIndex = res.final.indexOf("MARA");
  const koIndex = res.final.indexOf("KO");
  if (!(aaplIndex < maraIndex && maraIndex < koIndex)) {
    throw new Error("Ordering incorrect");
  }
});
