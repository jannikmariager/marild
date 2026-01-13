const ENGINE_STYLE_BY_KEY: Record<string, string> = {
  SWING_V1: 'Trend',
  SWING_V1_EXPANSION: 'Trend',
  SWING_V2_ROBUST: 'Robust Trend',
  SWING_V1_12_15DEC: 'Momentum',
  SWING_FAV8_SHADOW: 'Momentum',
  SWING_FAV8: 'Momentum',
  SWING: 'Trend',
  DAYTRADER_V4: 'Daytrade Momentum',
  DAYTRADER_V71: 'Daytrade Momentum',
  'V7.4': 'Daytrade Momentum',
  INVESTOR_V1: 'Long-Term',
  INVESTOR: 'Long-Term',
  SCALP_V1_MICROEDGE: 'Scalp Momentum',
  CRYPTO_V1_SHADOW: 'Crypto Momentum',
};

const ENGINE_STYLE_BY_TYPE: Record<string, string> = {
  SWING: 'Trend',
  DAYTRADER: 'Daytrade Momentum',
  INVESTOR: 'Long-Term',
  SCALP: 'Scalp Momentum',
  CRYPTO: 'Crypto Momentum',
};

export function getEngineStyleLabel(
  engineKey?: string | null,
  engineType?: string | null,
): string {
  if (engineKey && ENGINE_STYLE_BY_KEY[engineKey]) {
    return ENGINE_STYLE_BY_KEY[engineKey];
  }
  const typeKey = engineType?.toUpperCase();
  if (typeKey && ENGINE_STYLE_BY_TYPE[typeKey]) {
    return ENGINE_STYLE_BY_TYPE[typeKey];
  }
  return 'Trend';
}
