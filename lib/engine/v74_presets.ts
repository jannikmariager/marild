export type SignalStyle = "conservative" | "balanced" | "precision";

export const V74Presets = {
  conservative: {
    volatilityCompressionMin: 0.20,
    volatilityExpansionMin: 1.30,
    momentumThreshold: 0.27,
    trendStrength: 0.25,
    wickRejection: true,
  },

  balanced: {
    volatilityCompressionMin: 0.20,
    volatilityExpansionMin: 1.30,
    momentumThreshold: 0.30, // Optimal expectancy
    trendStrength: 0.275,
    wickRejection: true,
  },

  precision: {
    volatilityCompressionMin: 0.22,
    volatilityExpansionMin: 1.38,
    momentumThreshold: 0.345, // High-quality setups
    trendStrength: 0.30,
    wickRejection: true,
  },
} as const;

export type V74PresetConfig = (typeof V74Presets)[SignalStyle];
