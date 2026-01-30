// supabase/functions/_shared/backtest/engine/engine_core_v48.ts
// Core orchestrator: wire MTF inputs, enforce closed-candle logic, produce EngineSignalV48

import type { MultiTimeframeInput, EngineSignalV48, OHLCV, TFName } from './types.ts';
import type { EngineType } from '../../signal_types.ts';
import { runSMCEngine } from './smc_engine.ts';
import { runTrendEngine } from './trend_engine.ts';
import { runVolumeEngine } from './volume_engine.ts';
import { runLiquidityEngine } from './liquidity_engine.ts';
import { runVolatilityEngine } from './volatility_engine.ts';
import { selectSignal } from './signal_engine.ts';

// To keep performance reasonable on long horizons (e.g. 90d of 1m bars),
// all heavy modules operate on a rolling window rather than the full
// history from bar 0. This preserves recent structure while avoiding
// O(N^2) behavior.
const PRIMARY_LOOKBACK_BARS = 800; // ~2 trading days for 1m; safe for swing/invest too

// Select primary TF bars from MTF based on desired primary
function selectPrimaryBars(mtf: MultiTimeframeInput, tf: TFName): OHLCV[] {
  switch (tf) {
    case '1m': return mtf.tf_1m;
    case '5m': return mtf.tf_5m;
    case '15m': return mtf.tf_15m;
    case '1h': return mtf.tf_1h;
    case '4h': return mtf.tf_4h;
    case '1d': return mtf.tf_1d;
  }
}

export function evaluateSignalV48(params: {
  symbol: string;
  engineType: EngineType;
  primaryTf: TFName;
  mtf: MultiTimeframeInput;
  currentIndexPrimary: number;
}): EngineSignalV48 {
  const { symbol, engineType, primaryTf, mtf, currentIndexPrimary } = params;

  const primaryFull = selectPrimaryBars(mtf, primaryTf);
  // Slice to closed candle at currentIndexPrimary (inclusive) with rolling lookback
  const endIdx = currentIndexPrimary + 1;
  const startIdx = Math.max(0, endIdx - PRIMARY_LOOKBACK_BARS);
  const primary = primaryFull.slice(startIdx, endIdx);

  // Slice other TFs to align with primary close time (simplistic index
  // alignment with the same rolling window where possible)
  const sliceToIndex = (bars: OHLCV[]) => {
    const end = Math.min(bars.length, currentIndexPrimary + 1);
    const start = Math.max(0, end - PRIMARY_LOOKBACK_BARS);
    return bars.slice(start, end);
  };
  const tf_1d = sliceToIndex(mtf.tf_1d);
  const tf_4h = sliceToIndex(mtf.tf_4h);
  const tf_1h = sliceToIndex(mtf.tf_1h);
  const tf_15m = sliceToIndex(mtf.tf_15m);

  // Run modules
  const smc = runSMCEngine(primary);
  const trend = runTrendEngine({ tf_1d, tf_4h, tf_1h, tf_15m });
  const volume = runVolumeEngine(primary);
  const liquidity = runLiquidityEngine(primary);
  const volatility = runVolatilityEngine(primary);

  const decision = selectSignal({ primary, smc, trend, volume, liquidity, volatility });

  return {
    version: 'v4.8',
    direction: decision.direction,
    tp_price: decision.tp_price,
    sl_price: decision.sl_price,
    confidence: decision.confidence,
    reason: decision.reason,
    metadata: {
      smc,
      trend,
      volume,
      liquidity,
      volatility,
      engine_components: {
        smc: true,
        liquidity: true,
        volume_v2: true,
        trend_v2: true,
        exits_v2: true,
        risk_v2: true,
        shorting: true,
      },
    },
  };
}
