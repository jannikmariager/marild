// Shared engine brakes helper
// Used by model_portfolio_manager to implement P&L-based soft/hard brakes

export type BrakesState =
  | 'NORMAL'
  | 'THROTTLED'
  | 'HALTED_PROFIT'
  | 'HALTED_LOSS'
  | 'HALTED_TRADES';

export interface BrakesConfig {
  soft_enabled?: boolean;
  soft_lock_pnl?: number; // e.g. +800
  hard_enabled?: boolean;
  hard_lock_pnl?: number; // e.g. +1500
  max_daily_loss?: number; // e.g. -500
  max_trades_per_day?: number; // e.g. 25
  throttle_factor?: number; // e.g. 0.3
}

export interface EngineDailyState {
  engine_key: string;
  engine_version: string;
  trading_day: string; // YYYY-MM-DD (ET)
  state: BrakesState;
  daily_pnl: number;
  trades_count: number;
  throttle_factor: number;
  halt_reason: string | null;
  updated_at: string;
}

export interface BrakesDecision {
  state: BrakesState;
  throttleFactor: number;
  haltReason?: string | null;
}

// Convert a UTC Date to a trading-day key in America/New_York (YYYY-MM-DD)
export function getTradingDayET(nowUtc: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(nowUtc);
}

export async function loadEngineBrakesConfig(
  supabase: any,
  engineKey: string,
  engineVersion: string,
): Promise<BrakesConfig | null> {
  const { data, error } = await supabase
    .from('engine_versions')
    .select('settings')
    .eq('engine_key', engineKey)
    .eq('engine_version', engineVersion)
    .maybeSingle();

  if (error) {
    console.warn('[engine_brakes] Failed to load settings for', engineKey, engineVersion, error.message ?? error);
    return null;
  }

  const raw = (data as any)?.settings || {};
  const brakes = (raw as any).brakes || null;
  if (!brakes || typeof brakes !== 'object') return null;

  return {
    soft_enabled: toNumberOrUndefined(brakes.soft_enabled) ? Boolean(brakes.soft_enabled) : brakes.soft_enabled,
    soft_lock_pnl: toNumberOrUndefined(brakes.soft_lock_pnl),
    hard_enabled: toNumberOrUndefined(brakes.hard_enabled) ? Boolean(brakes.hard_enabled) : brakes.hard_enabled,
    hard_lock_pnl: toNumberOrUndefined(brakes.hard_lock_pnl),
    max_daily_loss: toNumberOrUndefined(brakes.max_daily_loss),
    max_trades_per_day: toNumberOrUndefined(brakes.max_trades_per_day),
    throttle_factor: toNumberOrUndefined(brakes.throttle_factor) ?? 0.3,
  };
}

function toNumberOrUndefined(value: any): number | undefined {
  if (value === null || value === undefined) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export async function getOrInitDailyState(
  supabase: any,
  engineKey: string,
  engineVersion: string,
  tradingDay: string,
  baseThrottleFactor: number,
): Promise<EngineDailyState> {
  const { data, error } = await supabase
    .from('engine_daily_state')
    .select('*')
    .eq('engine_key', engineKey)
    .eq('engine_version', engineVersion)
    .eq('trading_day', tradingDay)
    .maybeSingle();

  if (error) {
    console.warn('[engine_brakes] Failed to load engine_daily_state:', error.message ?? error);
  }

  if (data) {
    return data as EngineDailyState;
  }

  const insertPayload = {
    engine_key: engineKey,
    engine_version: engineVersion,
    trading_day: tradingDay,
    state: 'NORMAL' as BrakesState,
    daily_pnl: 0,
    trades_count: 0,
    throttle_factor: baseThrottleFactor,
    halt_reason: null,
  };

  const { data: inserted, error: insertError } = await supabase
    .from('engine_daily_state')
    .insert(insertPayload)
    .select('*')
    .maybeSingle();

  if (insertError) {
    console.warn('[engine_brakes] Failed to insert engine_daily_state:', insertError.message ?? insertError);
    // Return a synthetic default; writes will try again next tick.
    return insertPayload as unknown as EngineDailyState;
  }

  return inserted as EngineDailyState;
}

export function computeLiveDecision(
  dailyState: EngineDailyState,
  config: BrakesConfig | null,
): BrakesDecision {
  if (!config || !config.soft_enabled || config.soft_lock_pnl === undefined) {
    return { state: 'NORMAL', throttleFactor: 1 };
  }

  const threshold = config.soft_lock_pnl;
  if (dailyState.daily_pnl >= threshold) {
    const factor = config.throttle_factor ?? 0.3;
    return { state: 'THROTTLED', throttleFactor: factor };
  }

  return { state: 'NORMAL', throttleFactor: 1 };
}

export function computeShadowDecision(
  dailyState: EngineDailyState,
  config: BrakesConfig | null,
): BrakesDecision {
  if (!config || !config.throttle_factor) {
    return { state: 'NORMAL', throttleFactor: 1 };
  }

  const tf = config.throttle_factor ?? 0.3;
  const pnl = dailyState.daily_pnl;
  const trades = dailyState.trades_count;

  // Hard halts
  if (config.max_trades_per_day !== undefined && trades >= config.max_trades_per_day) {
    return {
      state: 'HALTED_TRADES',
      throttleFactor: 0,
      haltReason: `MAX_TRADES_PER_DAY (${config.max_trades_per_day}) reached`,
    };
  }

  if (config.max_daily_loss !== undefined && pnl <= config.max_daily_loss) {
    return {
      state: 'HALTED_LOSS',
      throttleFactor: 0,
      haltReason: `MAX_DAILY_LOSS (${config.max_daily_loss}) breached`,
    };
  }

  if (config.hard_lock_pnl !== undefined && pnl >= config.hard_lock_pnl) {
    return {
      state: 'HALTED_PROFIT',
      throttleFactor: 0,
      haltReason: `HARD_LOCK_PNL (${config.hard_lock_pnl}) reached`,
    };
  }

  // Soft throttle
  if (config.soft_lock_pnl !== undefined && pnl >= config.soft_lock_pnl) {
    return {
      state: 'THROTTLED',
      throttleFactor: tf,
    };
  }

  return { state: 'NORMAL', throttleFactor: 1 };
}

export async function upsertDailyState(
  supabase: any,
  engineKey: string,
  engineVersion: string,
  tradingDay: string,
  partial: Partial<Pick<EngineDailyState, 'state' | 'daily_pnl' | 'trades_count' | 'throttle_factor' | 'halt_reason'>>,
): Promise<void> {
  try {
    const payload = {
      engine_key: engineKey,
      engine_version: engineVersion,
      trading_day: tradingDay,
      updated_at: new Date().toISOString(),
      ...partial,
    };

    const { error } = await supabase
      .from('engine_daily_state')
      .upsert(payload, { onConflict: 'engine_key,engine_version,trading_day' });

    if (error) {
      console.warn('[engine_brakes] Failed to upsert engine_daily_state:', error.message ?? error);
    }
  } catch (err) {
    console.warn('[engine_brakes] Exception while upserting engine_daily_state:', (err as any)?.message ?? err);
  }
}
