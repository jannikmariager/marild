const ENGINE_STYLE_BY_VERSION: Record<string, string> = {
  SWING_V1: 'Trend',
  SWING_V1_EXPANSION: 'Trend',
  SWING_V2_ROBUST: 'Robust Trend',
  SWING_V1_12_15DEC: 'Momentum',
  SWING_FAV8_SHADOW: 'Momentum',
  SWING_FAV8: 'Momentum',
  'V7.4': 'Daytrade Momentum',
  DAYTRADER_V4: 'Daytrade Momentum',
  INVESTOR_V1: 'Long-Term',
  ADMIN_SWING: 'Experimental',
  SCALP_V1_MICROEDGE: 'Scalp Momentum',
  CRYPTO_V1_SHADOW: 'Crypto Momentum',
  QUICK_PROFIT_V1: 'Momentum',
};

const ENGINE_STYLE_BY_TYPE: Record<string, string> = {
  SWING: 'Trend',
  DAYTRADER: 'Daytrade Momentum',
  INVESTOR: 'Long-Term',
  SCALP: 'Scalp Momentum',
  CRYPTO: 'Crypto Momentum',
  QUICK_PROFIT: 'Momentum',
};

export function resolveEngineMetadata(
  engineType: string | null | undefined,
  engineVersion?: string | null,
) {
  const versionKey = engineVersion?.toUpperCase() ?? null;
  const typeKey = engineType?.toUpperCase() ?? null;
  const engine_key = versionKey || typeKey || 'UNKNOWN_ENGINE';
  const engine_style =
    (versionKey && ENGINE_STYLE_BY_VERSION[versionKey]) ||
    (typeKey && ENGINE_STYLE_BY_TYPE[typeKey]) ||
    'Trend';

  return { engine_key, engine_style };
}
