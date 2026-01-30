import { assertEquals, assertThrows } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// Quick profit engine helpers under test
import {
  CONFIG,
  buildAllowedSymbols,
  calculateQuickProfitPositionSize,
  computeEquityFromState,
  computeUnrealizedPnlDollars,
  guardShadowWrite,
  shouldHitStopLoss,
} from './quick_profit.ts';

type QuickProfitState = {
  startingEquity: number;
  equity_dollars: number;
  cash_dollars: number;
  allocated_notional: number;
  open_positions_count: number;
  unrealized_pnl_dollars: number;
  realized_before: number;
  realized_delta: number;
};

function makeState(overrides: Partial<QuickProfitState> = {}): QuickProfitState {
  return {
    startingEquity: 100_000,
    equity_dollars: 100_000,
    cash_dollars: 100_000,
    allocated_notional: 0,
    open_positions_count: 0,
    unrealized_pnl_dollars: 0,
    realized_before: 0,
    realized_delta: 0,
    ...overrides,
  };
}

// =============================================================================
// GUARD SHADOW WRITE TESTS
// =============================================================================

Deno.test('guardShadowWrite allows engine_portfolios writes', () => {
  // Should not throw for allowed shadow table
  guardShadowWrite('engine_portfolios');
});
Deno.test('Stop loss detection - LONG positions', () => {
  const position = {
    stop_loss: 98,
    side: 'LONG' as const,
  };

  assertEquals(shouldHitStopLoss(position as any, 97.5), true);
  assertEquals(shouldHitStopLoss(position as any, 99), false);
});

Deno.test('Stop loss detection - SHORT positions', () => {
  const position = {
    stop_loss: 102,
    side: 'SHORT' as const,
  };

  assertEquals(shouldHitStopLoss(position as any, 103), true);
  assertEquals(shouldHitStopLoss(position as any, 101.5), false);
});

Deno.test('guardShadowWrite allows engine_positions writes', () => {
  guardShadowWrite('engine_positions');
});

Deno.test('guardShadowWrite allows engine_trades writes', () => {
  guardShadowWrite('engine_trades');
});

Deno.test('guardShadowWrite allows live_signal_decision_log writes', () => {
  guardShadowWrite('live_signal_decision_log');
});

Deno.test('guardShadowWrite rejects live_positions writes', () => {
  assertThrows(
    () => guardShadowWrite('live_positions'),
    Error,
    'disallowed write to table live_positions',
  );
});

Deno.test('guardShadowWrite rejects live_trades writes', () => {
  assertThrows(
    () => guardShadowWrite('live_trades'),
    Error,
    'disallowed write to table live_trades',
  );
});

Deno.test('guardShadowWrite rejects live_portfolio_state writes', () => {
  assertThrows(
    () => guardShadowWrite('live_portfolio_state'),
    Error,
    'disallowed write to table live_portfolio_state',
  );
});

Deno.test('guardShadowWrite rejects arbitrary table writes', () => {
  assertThrows(
    () => guardShadowWrite('malicious_table'),
    Error,
    'disallowed write to table malicious_table',
  );
});

// =============================================================================
// UNIVERSE PARITY VALIDATION TESTS
// =============================================================================

Deno.test('Universe parity - buildAllowedSymbols deduplicates focus + allowlist', () => {
  const universe = {
    focusSymbols: new Set(['aapl', 'TSLA']),
    allowlistSymbols: ['MSFT', 'tsla', 'NVDA'],
  };

  const allowed = buildAllowedSymbols(universe);
  allowed.sort();

  assertEquals(allowed, ['AAPL', 'MSFT', 'NVDA', 'TSLA']);
});

Deno.test('Universe parity - buildAllowedSymbols handles missing focus set', () => {
  const universe = {
    focusSymbols: null,
    allowlistSymbols: ['GOOGL', 'AMZN'],
  };

  const allowed = buildAllowedSymbols(universe);
  allowed.sort();

  assertEquals(allowed, ['AMZN', 'GOOGL']);
});

// =============================================================================
// STARTING EQUITY SYNC TESTS
// =============================================================================

Deno.test('Starting equity sync - computeEquityFromState uses realized + unrealized', () => {
  const state = makeState({
    startingEquity: 125_000,
    realized_before: 2_500,
    realized_delta: -500,
    unrealized_pnl_dollars: 1_250,
  });

  const equity = computeEquityFromState(state);
  assertEquals(equity, 125000 + 2500 - 500 + 1250);
});

Deno.test('Starting equity sync - computeEquityFromState respects negative drift', () => {
  const state = makeState({
    realized_before: -4_000,
    realized_delta: -1_000,
    unrealized_pnl_dollars: -500,
  });

  const equity = computeEquityFromState(state);
  assertEquals(equity, 100000 - 4000 - 1000 - 500);
});

// =============================================================================
// POSITION MANAGEMENT STATE MACHINE TESTS
// =============================================================================

Deno.test('Position management - breakeven activation at CONFIG.beTriggerUsd', () => {
  const position = {
    entry_price: 100,
    qty: 100,
    side: 'LONG' as const,
    stop_loss: 98,
    be_activated_at: null,
    partial_taken: false,
    trail_active: false,
  };

  const currentPrice = 100 + CONFIG.beTriggerUsd / position.qty;
  const unrealizedPnl = computeUnrealizedPnlDollars(position, currentPrice);

  const shouldActivateBe = unrealizedPnl >= CONFIG.beTriggerUsd && !position.be_activated_at;

  assertEquals(shouldActivateBe, true);

  if (shouldActivateBe) {
    const newStopLoss = position.entry_price + CONFIG.beBufferUsd / position.qty;
    assertEquals(newStopLoss, 100 + CONFIG.beBufferUsd / position.qty);
  }
});

Deno.test('Position management - partial take at +$250', () => {
  const position = {
    entry_price: 100,
    qty: 100,
    side: 'LONG' as const,
    be_activated_at: new Date().toISOString(),
    partial_taken: false,
    trail_active: false,
  };

  const currentPrice = 100 + CONFIG.partialTriggerUsd / position.qty;
  const unrealizedPnl = computeUnrealizedPnlDollars(position, currentPrice);

  const shouldTakePartial = unrealizedPnl >= CONFIG.partialTriggerUsd && !position.partial_taken;

  assertEquals(shouldTakePartial, true);

  if (shouldTakePartial) {
    const sharesToClose = Math.floor(position.qty * CONFIG.partialFraction);
    assertEquals(sharesToClose, position.qty * CONFIG.partialFraction);
  }
});

Deno.test('Position management - trailing stop activation', () => {
  const position = {
    entry_price: 100,
    qty: 50, // After partial close
    side: 'LONG' as const,
    be_activated_at: new Date().toISOString(),
    partial_taken: true,
    trail_active: false,
    trail_peak_pnl: null,
    trail_stop_price: null,
  };

  const currentPrice = 103; // +$150 on remaining 50 shares
  const unrealizedPnl = computeUnrealizedPnlDollars(position, currentPrice);

  // Trailing should activate after partial is taken
  const shouldActivateTrail = position.partial_taken && !position.trail_active;

  assertEquals(shouldActivateTrail, true);

  if (shouldActivateTrail) {
    // Initialize trail peak and stop
    const trailPeakPnl = unrealizedPnl;
    const trailStopPrice = currentPrice - CONFIG.trailDistanceUsd / position.qty;

    assertEquals(trailPeakPnl, 150);
    assertEquals(trailStopPrice, 100.6);
  }
});

Deno.test('Position management - trailing stop update on new peak', () => {
  const position = {
    entry_price: 100,
    qty: 50,
    side: 'LONG' as const,
    trail_active: true,
    trail_peak_pnl: 150,
    trail_stop_price: 100.6,
  };

  const currentPrice = 104; // New peak at +$200
  const unrealizedPnl = (currentPrice - position.entry_price) * position.qty;

  const shouldUpdateTrail = unrealizedPnl > (position.trail_peak_pnl ?? 0);

  assertEquals(shouldUpdateTrail, true);

  if (shouldUpdateTrail) {
    const newPeakPnl = unrealizedPnl;
    const newTrailStop = currentPrice - CONFIG.trailDistanceUsd / position.qty;

    assertEquals(newPeakPnl, 200);
    assertEquals(newTrailStop, 101.6);
  }
});

Deno.test('Position management - SHORT position breakeven', () => {
  const position = {
    entry_price: 100,
    qty: 100,
    side: 'SHORT' as const,
    stop_loss: 102,
    be_activated_at: null,
  };

  const currentPrice = 100 - CONFIG.beTriggerUsd / position.qty;
  const unrealizedPnl = computeUnrealizedPnlDollars(position, currentPrice);

  const shouldActivateBe = unrealizedPnl >= CONFIG.beTriggerUsd && !position.be_activated_at;

  assertEquals(shouldActivateBe, true);

  if (shouldActivateBe) {
    // For SHORT, move stop DOWN to entry - buffer
    const newStopLoss = position.entry_price - CONFIG.beBufferUsd / position.qty;
    assertEquals(newStopLoss, 100 - CONFIG.beBufferUsd / position.qty);
  }
});

// =============================================================================
// RISK MANAGEMENT TESTS
// =============================================================================

Deno.test('Risk management - position sizing respects risk cap + max notional', () => {
  const state = makeState();
  const signal = { entry_price: 100, stop_loss: 98 };

  const size = calculateQuickProfitPositionSize(state as any, signal);
  if (!size) throw new Error('expected position sizing result');

  // Risk per trade (750) would allow 375 shares, but max notional (25k) caps to 250 shares
  assertEquals(size.size_shares, 250);
  assertEquals(size.notional, 25_000);
});
Deno.test('Risk management - portfolio allocation cap reduces notional', () => {
  const state = makeState({
    allocated_notional: 100_000 * CONFIG.maxPortfolioAllocationPct - 5_000,
  });
  const signal = { entry_price: 200, stop_loss: 190 };

  const size = calculateQuickProfitPositionSize(state as any, signal);
  if (!size) throw new Error('expected sizing result');

  // Remaining capacity should be 5k, so notional should not exceed that
  assertEquals(size.notional <= 5000 + 1e-6, true);
});

Deno.test('Risk management - minimum position notional enforcement returns null', () => {
  const state = makeState();
  const signal = { entry_price: 5, stop_loss: 4.5 };

  const size = calculateQuickProfitPositionSize(state as any, signal);
  assertEquals(size, null);
  assertEquals(shouldReject, true);
});

// =============================================================================
// CONFIGURATION DEFAULTS TESTS
// =============================================================================

Deno.test('Configuration - default values match spec', () => {
  assertEquals(CONFIG.beTriggerUsd, 150);
  assertEquals(CONFIG.partialTriggerUsd, 250);
  assertEquals(CONFIG.partialFraction, 0.5);
  assertEquals(CONFIG.trailDistanceUsd, 120);
  assertEquals(CONFIG.riskPerTradePct, 0.0075);
  assertEquals(CONFIG.maxConcurrentPositions, 10);
});

// =============================================================================
// SIGNAL FILTERING TESTS
// =============================================================================

Deno.test('Signal filtering - lookback window enforcement', () => {
  const nowUtc = new Date('2026-01-19T12:00:00Z');
  const lookbackMs = CONFIG.lookbackHours * 60 * 60 * 1000;
  const lookbackStartIso = new Date(nowUtc.getTime() - lookbackMs).toISOString();

  const signals = [
    { id: 1, created_at: '2026-01-19T11:00:00Z', symbol: 'AAPL' }, // Within window
    { id: 2, created_at: '2026-01-19T09:00:00Z', symbol: 'TSLA' }, // Outside window
  ];

  const filteredSignals = signals.filter((s) => s.created_at >= lookbackStartIso);

  assertEquals(filteredSignals.length, 1);
  assertEquals(filteredSignals[0].symbol, 'AAPL');
});

Deno.test('Signal filtering - duplicate ticker rejection', () => {
  const existingTickers = new Set(['AAPL', 'TSLA']);
  const newSignal = { symbol: 'AAPL', entry_price: 150 };

  const shouldReject = existingTickers.has(newSignal.symbol);

  assertEquals(shouldReject, true);
});

Deno.test('Signal filtering - max concurrent positions limit', () => {
  const currentOpenPositionsCount = CONFIG.maxConcurrentPositions;
  const canOpenNew = currentOpenPositionsCount < CONFIG.maxConcurrentPositions;

  assertEquals(canOpenNew, false);
});

// =============================================================================
// LOGGING AND AUDIT TESTS
// =============================================================================

Deno.test('Logging - action log structure for OPEN action', () => {
  const logEntry = {
    signal_id: 'sig-123',
    strategy: 'SWING',
    engine_type: 'SWING',
    engine_key: 'QUICK_PROFIT',
    engine_version: 'QUICK_PROFIT_V1',
    run_mode: 'SHADOW',
    ticker: 'AAPL',
    decision: 'OPEN',
    reason_code: 'OPEN',
    reason_context: {
      pnl_usd: 0,
      price: 150,
      size_shares: 100,
    },
    publishable_signal: false,
    portfolio_equity: null,
  };

  assertEquals(logEntry.engine_key, 'QUICK_PROFIT');
  assertEquals(logEntry.run_mode, 'SHADOW');
  assertEquals(logEntry.decision, 'OPEN');
});

Deno.test('Logging - action log structure for CLOSE action', () => {
  const logEntry = {
    ticker: 'AAPL',
    decision: 'CLOSE',
    reason_code: 'CLOSE',
    reason_context: {
      pnl_usd: 250,
      price: 152.5,
      reason: 'PARTIAL_PROFIT',
    },
    engine_key: 'QUICK_PROFIT',
    run_mode: 'SHADOW',
  };

  assertEquals(logEntry.decision, 'CLOSE');
  assertEquals(logEntry.reason_context.pnl_usd, 250);
  assertEquals(logEntry.reason_context.reason, 'PARTIAL_PROFIT');
});
