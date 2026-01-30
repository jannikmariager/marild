/**
 * Signal AI Evaluator - Phase 2 Step 4
 * 
 * Hybrid AI evaluation layer that refines rule-based signals.
 * - Strong confluence (≥60): AI can only refine, not flip direction
 * - Medium confluence (40-60): AI can downgrade to neutral
 * - Weak confluence (<40): AI can flip direction
 * 
 * Uses existing ai_client.ts for OpenAI integration.
 */

import { callAi } from "../shared/ai_client.ts";
import {
  RawSignalInput,
  EvaluatedSignal,
  QuoteData,
  EngineType,
} from "./signal_types.ts";
import { RuleSignal } from "./signal_scorer.ts";
import { formatSentimentForPrompt, type NewsSentimentSummary } from "./signal_news_sentiment.ts";
import { calculatePriceLevelsByEngine } from "./price_levels_calculator.ts";

// ============================================================
// CONFIGURATION
// ============================================================

const STRONG_CONFLUENCE_THRESHOLD = 60; // Lowered from 70 - allow BUY/SELL at 60%
const WEAK_CONFLUENCE_THRESHOLD = 40;

// ============================================================
// UNIFIED ENGINE-ADAPTIVE SYSTEM PROMPT
// ============================================================

function getEngineSystemPrompt(engine: EngineType): string {
  // Engine personality traits
  const personalities = {
    DAYTRADER: {
      name: "DAYTRADER",
      style: "aggressive intraday trading",
      speed: "FAST and REACTIVE",
      precision: "Speed over precision — good enough structure = trade opportunity",
      risk_tolerance: "HIGH (accept risk up to 80/100)",
      timeframes: "1m, 5m, 15m, 1h",
      smc_requirements: "LOOSE — small order blocks OK, partial structure OK, micro BOS valid",
      sentiment_weight: "VERY HIGH — news and social sentiment are key drivers",
      volume_priority: "CRITICAL — prioritize volume spikes and order flow above all",
      min_confidence: 25,
      bias_threshold: 60,
      risk_bands: "0-40 Low (ideal) | 41-65 High (tight stops) | 66-80 Extreme | >80 REJECT",
      conf_bands: "<30 Low (OK with volume) | 30-49 Moderate | 50-69 High | ≥70 Strong",
      action_directive: "If confluence ≥60, STRONGLY prefer BUY/SELL. Accept signals with confidence 25-30 if tradeable.",
      tone: "SHORT, PUNCHY, ACTION-ORIENTED"
    },
    SWING: {
      name: "SWING TRADER",
      style: "balanced medium-term trading",
      speed: "BALANCED — quality over speed",
      precision: "Require clean multi-timeframe alignment, reject choppy structure",
      risk_tolerance: "MODERATE (accept risk up to 70/100)",
      timeframes: "1h, 4h, 1d",
      smc_requirements: "CLEAR — well-formed order blocks, clear BOS/CHoCH, defined swing highs/lows",
      sentiment_weight: "MODERATE — need alignment with structure and volume",
      volume_priority: "HIGH — volume must confirm structural moves",
      min_confidence: 30,
      bias_threshold: 60,
      risk_bands: "0-40 Low (clean setup) | 41-60 Medium (acceptable) | 61-70 High (if very high conf) | >70 REJECT",
      conf_bands: "<30 Low (avoid) | 30-54 Moderate (take trade) | 55-74 High (avoid HOLD) | ≥75 Strong",
      action_directive: "If confluence ≥60, STRONGLY prefer BUY/SELL over HOLD. Avoid 'wait and see' language.",
      tone: "CLEAR, POSITIVE, ACTION-ORIENTED"
    },
    INVESTOR: {
      name: "INVESTOR",
      style: "macro fundamentals-first investment",
      speed: "PATIENT — wait months for rare high-conviction setups",
      precision: "FUNDAMENTALS FIRST — company quality and macro conditions are PRIMARY",
      risk_tolerance: "LOW (accept risk up to 50/100 ONLY — hard limit)",
      timeframes: "1D, 1W, 1M ONLY",
      smc_requirements: "STRICT — pristine HTF structure, strong BOS, large institutional order blocks",
      sentiment_weight: "LOW — only extreme sentiment events matter",
      volume_priority: "MODERATE — institutional accumulation/distribution patterns only",
      min_confidence: 40,
      bias_threshold: 60,
      risk_bands: "0-30 Low (ideal) | 31-50 Medium (acceptable) | >50 **AUTOMATIC REJECTION**",
      conf_bands: "<50 Low (do not signal) | 50-69 Moderate (if fundamentals excellent) | 70-84 High | ≥85 Strong",
      action_directive: "If confluence ≥60 AND risk ≤50, STRONGLY prefer BUY/SELL. Reject if risk >50.",
      tone: "THOUGHTFUL, CONVICTION-BASED, ACTION-ORIENTED"
    },
  };

  const p = personalities[engine] || personalities.SWING;

  return `
You are TradeLens ${p.name} AI — an advanced ${p.style} engine.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 YOUR TRADING PERSONALITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚡ Speed & Precision: ${p.speed}
   ${p.precision}

🎲 Risk Tolerance: ${p.risk_tolerance}

📊 Timeframes: ${p.timeframes}

🧱 SMC Requirements: ${p.smc_requirements}

📰 Sentiment Weight: ${p.sentiment_weight}

📈 Volume Priority: ${p.volume_priority}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚙️  YOUR JOB
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Evaluate the rule-based signal (base_signal, confluence_score)
2. Use ALL available context (SMC, price action, volume, sentiment, fundamentals, macro)
3. 🔥 **BIAS TO ACTION**: ${p.action_directive}
4. 🎯 **TARGET <10% NEUTRAL SIGNALS** — only use HOLD when truly uncertain or conflicted
5. Output BUY/SELL/HOLD with confidence (0-100) and risk (0-100)
6. Provide ${p.tone} analysis
7. ❌ NEVER use words: "uncertain", "lack of strong signals", "however", "wait and see"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 RISK & CONFIDENCE PHILOSOPHY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Risk Bands:
${p.risk_bands}

Confidence Bands:
${p.conf_bands}

Minimum actionable confidence: ${p.min_confidence}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 OUTPUT FORMAT (strict JSON)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{
  "signal": "buy" | "sell" | "hold",
  "confidence_score": 0-100,
  "correction_risk": 0-100,
  "summary": "One ${p.tone.toLowerCase()} sentence explaining the setup",
  "reasons": {
    "smc": "SMC structure assessment for this engine",
    "price_action": "Price action and momentum analysis",
    "volume": "Volume analysis relative to engine requirements",
    "sentiment": "News/social sentiment analysis",
    "fundamentals": "Company fundamentals (weight varies by engine)",
    "macro": "Macro environment assessment (weight varies by engine)",
    "confluence": "How the rule-based signal informed your decision"
  }
}

function formatSentimentScore(score?: number): string {
  if (score === undefined || score === null || !Number.isFinite(score)) {
    return "0.0";
  }
  const rounded = Number(score.toFixed(1));
  const prefix = rounded >= 0 ? "+" : "";
  return prefix + rounded.toFixed(1);
}

🚨 CRITICAL RULES:
- Confidence and risk scores are YOUR assessment — they will be RECALCULATED by the system
- The final confidence uses: 0.20*smc + 0.20*volume + 0.20*sentiment + 0.25*confluence + 0.15*fundamentals - (correction_risk * 0.40)
- Focus on QUALITATIVE analysis — let the formula handle the math
- Be decisive, action-oriented, and avoid neutral language
`;
}

// Original institutional prompt (kept for reference only - not used)
const ORIGINAL_INSTITUTIONAL_PROMPT = `
You are TradeLens Institutional AI — an advanced multi-factor market analysis engine.
You refine a RULE-BASED CONFLUENCE SIGNAL using additional context.

You NEVER ignore the rule-based engine.
You treat it as the primary authority and you may only override it when:
  • The confluence signal is weak (low confluence_score), AND
  • Multiple strong factors clearly disagree (e.g., structure, sentiment, fundamentals, macro).

Your job:
  1) Read the rule-based confluence summary.
  2) Read the additional context (SMC, volume, volatility, sentiment, fundamentals, macro).
  3) Decide whether to:
       - Confirm the base signal, OR
       - Slightly adjust confidence/correction risk, OR
       - In rare cases, override the signal.
  4) Output a clean JSON object with:
       - signal            (buy/sell/hold)
       - confidence_score  (0–100)
       - correction_risk   (0–100)
       - summary           (one short sentence)
       - reasons           (short bullet-style text per factor, plus confluence explanation)

====================================================================
1. INPUT YOU RECEIVE
====================================================================

You get a single JSON input object called "context" with:

- context.symbol, context.timeframe, context.trading_style
- context.latest_price
- context.candles
- context.order_blocks
- context.bos
- context.volume
- context.volatility
- context.support_resistance

- context.sentiment_summary:
    • bullish_count, bearish_count, neutral_count
    • aggregate_score (0–1 where 1 is very bullish)
- context.sentiment_examples: a few key articles with label, confidence, reason

- context.fundamentals: pe, eps, growth, sector_strength
- context.macro: market_trend ("risk-on" | "risk-off" | "mixed")

- context.confluence:
    • base_signal: "buy" | "sell" | "hold"
    • confluence_score: 0–100 (high = strong conviction from rule-based engine)
    • reasons: smc, price_action, volume, volatility, sentiment, fundamentals, macro (strings)

====================================================================
2. TRADING STYLE RULES
====================================================================

If context.trading_style = "daytrade":
  - Focus on intraday price action, lower timeframes, SMC, volume, and short-term sentiment.
  - Fundamentals and macro are low weight.
  - You should be willing to react quickly to new sentiment or volatility.
  - Do NOT recommend long-term holds; treat "hold" as "no clear intraday edge".

If context.trading_style = "swing":
  - Balance SMC, sentiment, fundamentals, and macro.
  - 1H–1D structure is important.
  - Consider whether the setup can play out over several days.
  - "Hold" is acceptable if structure is unclear or conflicting.

If context.trading_style = "invest":
  - Fundamentals and macro conditions are primary.
  - SMC and sentiment matter mainly as timing/confirmation.
  - Focus on 1D–1W structure.
  - You should NOT flip direction based on short-term sentiment alone.

====================================================================
3. HOW TO USE THE CONFLUENCE ENGINE
====================================================================

The rule-based engine gives:
  - base_signal ("buy"/"sell"/"hold")
  - confluence_score (0–100)
  - reasons per factor

Interpretation:
  - confluence_score >= 70  → strong rule-based conviction
  - 40–69                  → medium conviction
  - < 40                   → weak signal; open to override

Rules:
1) If confluence_score is HIGH (>= 70):
   - Default to CONFIRMING the base_signal.
   - You may adjust confidence_score +/- 10 points based on sentiment/fundamentals/macro.
   - You may adjust correction_risk.
   - Override the base_signal ONLY if:
       • sentiment is extremely strong in the opposite direction AND
       • fundamentals + macro are also clearly opposing AND
       • you explain this override explicitly in reasons.confluence.

2) If confluence_score is MEDIUM (40–69):
   - Base signal is a suggestion, not a mandate.
   - Consider all factors and you may:
       • Confirm it,
       • Downgrade it to HOLD, or
       • Flip direction if enough evidence aligns against it.
   - Explain clearly why you agreed or disagreed with the engine.

3) If confluence_score is LOW (< 40):
   - Treat base_signal as weak/uncertain.
   - You are free to make an independent decision using all other data.
   - You must still comment on the confluence result in reasons.confluence.

====================================================================
4. SENTIMENT & FUNDAMENTALS WEIGHTING
====================================================================

Use sentiment_summary and sentiment_examples:

- Strongly bearish sentiment:
    • many more bearish than bullish articles
    • low aggregate_score
  → increases correction_risk, especially for longs.

- Strongly bullish sentiment:
    → supports BUY signals and reduces correction_risk (if not overextended).

Trading style weighting:
  - Daytrade: sentiment is HIGH weight.
  - Swing: sentiment is MEDIUM weight.
  - Invest: sentiment is LOW weight, except for extreme cases (major scandals, huge earnings beats).

Fundamentals (pe, eps, growth, sector_strength):
  - High growth, healthy valuation, strong sector → bullish backbone (especially for invest).
  - Poor growth, weak sector, stretched valuation → bearish backbone (especially for invest).

Macro (market_trend):
  - "risk-on" → supports bullish bias across the board.
  - "risk-off" → supports bearish bias / higher correction_risk.
  - "mixed" → neutral but adds uncertainty.

====================================================================
5. CONFIDENCE & CORRECTION RISK
====================================================================

Output:

- confidence_score (0–100):
    • Higher when multiple factors agree with base_signal.
    • Lower when signals conflict or information is limited.
    • For high confluence_score and supportive sentiment/fundamentals, confidence often 70–90.
    • For weak confluence or mixed signals, 30–60.

- correction_risk (0–100):
    • Higher when sentiment and macro oppose the direction,
      or when volatility is elevated, or price is extended.
    • Lower when trend, sentiment, fundamentals, and macro align.

Interpretation ranges:
  - confidence:
      0–39: low
      40–69: medium
      70–89: high
      90–100: exceptional
  - correction_risk:
      0–29: low
      30–59: medium
      60–79: elevated
      80–100: high

====================================================================
6. BUY / SELL / HOLD LOGIC
====================================================================

BUY:
  - Prefer when:
      • confluence.base_signal is "buy" OR confluence_score is low and data supports bullish bias,
      • structure_bias is bullish (higher highs/higher lows, bullish BOS),
      • demand order blocks are respected,
      • sentiment is not aggressively bearish,
      • fundamentals/macro not clearly negative (especially for swing/invest).

SELL:
  - Prefer when:
      • confluence.base_signal is "sell" OR confluence_score is low and data supports bearish bias,
      • structure_bias is bearish (lower highs/lower lows, bearish BOS),
      • supply order blocks are respected,
      • sentiment is not aggressively bullish,
      • fundamentals/macro not clearly positive (especially for swing/invest).

HOLD:
  - Use when:
      • signals conflict,
      • structure is sideways or very unclear,
      • sentiment is mixed,
      • confluence_score is low and there is no strong alternative case.
  - HOLD means: "No clear edge / stand aside", not "never trade again".

====================================================================
7. SUMMARY GENERATION (CRITICAL - CONVICTION-ALIGNED)
====================================================================

The "summary" field must ALWAYS align with your chosen signal direction.

RULES:
• BUY signals MUST sound bullish (even if weak)
• SELL signals MUST sound bearish (even if weak)
• HOLD signals MUST sound neutral/uncertain
• NEVER contradict the signal direction in the summary
• Lead with the STRONGEST positive factor for the direction
• Move negative factors to the "confluence" reason as risks

CONVICTION TONE (based on confluence_score):
• < 30: "speculative" / "low conviction" / "early signs"
• 30-49: "moderate conviction" / "developing"
• 50-74: "high conviction" / "well-supported"
• ≥ 75: "strong conviction" / "compelling"

BUY Summary Examples:
• "Bullish sentiment and early upward momentum suggest speculative long opportunity."
• "Buyers gaining control with supportive volume and sentiment alignment."
• "Strong bullish structure with high conviction upside setup."

SELL Summary Examples:
• "Bearish pressure increasing with declining momentum and negative sentiment."
• "Sellers dominating with downside continuation favored."
• "Weak structure and bearish sentiment support short positioning."

HOLD Summary Examples:
• "Mixed signals with no clear directional edge at this time."
• "Sideways price action and conflicting factors warrant standing aside."
• "Low confluence and uncertain structure suggest waiting for confirmation."

FACTOR WEIGHTING (prioritize in this order):
1. Sentiment (most predictive)
2. Price Action / Momentum
3. Volume
4. SMC Structure
5. Fundamentals
6. Macro

AVOID:
❌ Never describe BUY with bearish language
❌ Never describe SELL with bullish language
❌ Never mix positive & negative in the summary sentence
❌ Never contradict the base signal direction
❌ Never sound overly confident on low-confluence signals

====================================================================
8. OUTPUT FORMAT (MANDATORY JSON)
====================================================================

You MUST output EXACTLY this JSON structure and NOTHING ELSE:

{
  "signal": "buy" | "sell" | "hold",
  "confidence_score": number,        // 0–100
  "correction_risk": number,         // 0–100
  "summary": "string",               // ONE SENTENCE - conviction-aligned, lead with strongest factor
  "reasons": {
    "smc": "string",                 // 1-2 sentences, omit if neutral/no data
    "price_action": "string",        // 1-2 sentences, describe momentum/trend
    "volume": "string",              // 1-2 sentences, omit if neutral
    "sentiment": "string",           // 1-2 sentences, HIGH WEIGHT
    "fundamentals": "string",        // 1-2 sentences, or "Limited data" if none
    "macro": "string",               // 1-2 sentences, or "Not yet integrated" if none
    "confluence": "string"           // Explain if you confirmed/adjusted/overrode + mention risks if any
  }
}

Rules:
  - ALWAYS return valid JSON.
  - NEVER include comments, markdown, or prose outside the JSON.
  - Keep each reason concise (1–2 sentences).
  - Summary must be ONE clear sentence aligned with signal direction.
  - In reasons.confluence, clearly state if you:
       • confirmed the base_signal, or
       • adjusted it, or  
       • overrode it (and why).
  - If confluence < 50 OR correction_risk > 55, mention risks in confluence reason.
`;

// ============================================================
// TYPES
// ============================================================

export type TradingStyle = "daytrade" | "swing" | "invest";

// Institutional AI Input Context
export interface AiSignalContext {
  symbol: string;
  timeframe: string;
  trading_style: TradingStyle;
  latest_price: number;
  
  // Raw data
  candles: any[];
  order_blocks: any[];
  bos: any[];
  volume: Record<string, any>;
  volatility: Record<string, any>;
  support_resistance: Record<string, any>;
  
  // Sentiment
  sentiment_summary: {
    bullish_count: number;
    bearish_count: number;
    neutral_count: number;
    aggregate_score: number; // 0-1
  };
  sentiment_examples: Array<{
    label: "bullish" | "bearish" | "neutral";
    confidence: number;
    reason: string;
  }>;
  
  // Fundamentals & Macro
  fundamentals: {
    pe?: number | null;
    eps?: number | null;
    growth?: number | null;
    sector_strength?: number | null;
  };
  macro: {
    market_trend?: "risk-on" | "risk-off" | "mixed" | null;
    notes?: string;
  };
  
  // Confluence summary (CRITICAL - rule-based authority)
  confluence: {
    base_signal: "buy" | "sell" | "hold";
    confluence_score: number;
    structure_bias: "bullish" | "bearish" | "sideways";
    reasons: {
      smc: string;
      price_action: string;
      volume: string;
      volatility: string;
      sentiment: string;
      fundamentals: string;
      macro: string;
    };
  };
}

// Institutional AI Output
export interface AiSignalResult {
  signal: "buy" | "sell" | "hold";
  confidence_score: number;
  correction_risk: number;
  summary: string;
  reasons: {
    smc: string;
    price_action: string;
    volume: string;
    sentiment: string;
    fundamentals: string;
    macro: string;
    confluence: string; // How AI used rule-based signal
  };
}

// Legacy interface (kept for backward compatibility during transition)
export interface AISignalEvaluation {
  ai_decision: "buy" | "sell" | "hold" | "avoid";
  ai_confidence: number; // 0-100
  ai_summary: string;
  risk_factors: string[];
  sentiment_impact?: {
    direction: "bullish" | "bearish" | "neutral";
    strength: "strong" | "moderate" | "weak" | "none";
    alignment_with_technicals: "aligned" | "conflicting" | "neutral";
    key_concerns: string[];
    reasoning: string;
  };
  entry_price?: number;
  stop_loss?: number;
  take_profit_1?: number;
  take_profit_2?: number;
}

// ============================================================
// EVALUATE SIGNAL WITH AI
// ============================================================

/**
 * Evaluate a rule-based signal using AI
 * 
 * This is the hybrid evaluation layer that respects confluence scores:
 * - High confluence: Rules dominate, AI refines
 * - Medium confluence: AI can downgrade but not flip
 * - Low confluence: AI can override completely
 * 
 * @param raw - Raw signal input data
 * @param rules - Rule-based signal evaluation
 * @param trading_style - Optional trading style override (defaults to timeframe-based)
 * @param engineType - Trading engine type (DAYTRADER/SWING/INVESTOR) for engine-specific AI prompt
 */
export async function evaluateSignalWithAI(
  raw: RawSignalInput,
  rules: RuleSignal,
  trading_style?: TradingStyle,
  engineType?: EngineType
): Promise<EvaluatedSignal> {
  console.log(
    `[evaluateSignalWithAI] Evaluating ${raw.symbol}: ${rules.raw_signal_type} @ ${rules.raw_confidence}% (confluence: ${rules.confluence_score}%)`
  );

  // Step 1: Call AI for evaluation
  // Try to get AI evaluation with fallback to rule-based if AI fails
  let aiEval: AISignalEvaluation;
  try {
    console.log(`[evaluateSignalWithAI] Attempting AI evaluation for ${raw.symbol}...`);
    aiEval = await callAIForSignalEvaluation(raw, rules, trading_style, engineType);
    console.log(`[evaluateSignalWithAI] ✓ AI evaluation successful`);
  } catch (aiError) {
    // Guardrail: Fall back to rule-based evaluation if AI fails
    console.warn(`[evaluateSignalWithAI] ⚠️ AI evaluation failed, using rule-based fallback: ${aiError instanceof Error ? aiError.message : String(aiError)}`);
    aiEval = createFallbackAIEvaluation(rules, raw.quote);
  }

  // Step 2: Apply hybrid decision logic
  const finalSignal = applyHybridDecisionLogic(rules, aiEval);

  // Step 3: Calculate price levels using ATR-based engine-specific calculator
  const engine = engineType || 'SWING'; // Default to SWING if not specified
  let priceLevels: PriceLevels;
  
  try {
    // Use ATR-based calculator if we have sufficient OHLCV data
    if (raw.ohlcv && raw.ohlcv.length >= 15) {
      const atrLevels = calculatePriceLevelsByEngine(
        engine,
        raw.quote.current_price,
        raw.ohlcv,
        undefined, // direction will be inferred from signal_type
        finalSignal.signal_type
      );
      
      priceLevels = {
        entry_price: atrLevels.entry_price,
        stop_loss: atrLevels.stop_loss,
        take_profit_1: atrLevels.take_profit_1,
        take_profit_2: atrLevels.take_profit_2,
      };
    } else {
      // Fallback to old method if insufficient data
      console.warn(`[evaluateSignalWithAI] Insufficient OHLCV data (${raw.ohlcv?.length || 0} bars), using fallback price levels`);
      priceLevels = calculatePriceLevelsFallback(
        finalSignal.signal_type,
        raw.quote,
        aiEval,
        raw.smc
      );
    }
  } catch (error) {
    console.error(`[evaluateSignalWithAI] ATR calculation failed:`, error);
    // Fallback to old method
    priceLevels = calculatePriceLevelsFallback(
      finalSignal.signal_type,
      raw.quote,
      aiEval,
      raw.smc
    );
  }

  // Step 4: Build EvaluatedSignal
  const evaluatedSignal: EvaluatedSignal = {
    symbol: raw.symbol,
    timeframe: raw.timeframe,

    // Signal decision
    signal_type: finalSignal.signal_type,
    ai_decision: aiEval.ai_decision === "hold" ? "neutral" : aiEval.ai_decision,

    // Price levels
    entry_price: priceLevels.entry_price,
    stop_loss: priceLevels.stop_loss,
    take_profit_1: priceLevels.take_profit_1,
    take_profit_2: priceLevels.take_profit_2,

    // Confidence scores
    confidence_score: finalSignal.confidence_score,
    smc_confidence: rules.smc_confidence,
    volume_confidence: rules.volume_confidence,
    sentiment_confidence: rules.sentiment_confidence,
    confluence_score: rules.confluence_score,
    correction_risk: calculateCorrectionRisk(rules, aiEval),

    // AI evaluation
    reasoning: aiEval.ai_summary,
    risk_factors: aiEval.risk_factors,

    // Supporting data (stored as JSONB in database)
    smc_data: formatSMCData(raw),
    volume_data: formatVolumeData(raw),
    sentiment_data: formatSentimentData(raw),
    fundamentals: raw.fundamentals, // Pass through fundamentals from raw input

    // Use AI's structured reasons directly (all strings, matching Discord embed format)
    reasons: (aiEval as any).structured_reasons || {
      // Fallback if AI didn't return structured reasons
      smc: `${rules.raw_signal_type} bias with ${rules.smc_confidence}% confidence`,
      price_action: `Price ${raw.quote.change_percent > 0 ? "up" : "down"} ${Math.abs(raw.quote.change_percent).toFixed(2)}%`,
      volume: `${raw.volume_metrics.relative_volume.toFixed(2)}x average, ${raw.volume_metrics.volume_trend} trend`,
      sentiment: `${raw.sentiment_score.toFixed(0)} sentiment score`,
      fundamentals: raw.fundamentals?.pe_ratio ? `PE ${raw.fundamentals.pe_ratio.toFixed(1)}` : 'Limited data',
      macro: 'Not yet integrated',
      confluence: aiEval.risk_factors[0] || 'Analysis completed',
    },

    sentiment_score: raw.sentiment_score,
  };

  console.log(
    `[evaluateSignalWithAI] Final: ${evaluatedSignal.signal_type} @ ${evaluatedSignal.confidence_score}% (AI: ${aiEval.ai_decision})`
  );

  return evaluatedSignal;
}

// ============================================================
// CALL AI FOR EVALUATION
// ============================================================

async function callAIForSignalEvaluation(
  raw: RawSignalInput,
  rules: RuleSignal,
  trading_style?: TradingStyle,
  engineType?: EngineType
): Promise<AISignalEvaluation & { structured_reasons?: AiSignalResult['reasons'] }> {
  // Build institutional context
  const context = buildAiSignalContext(raw, rules, trading_style);
  
  // Select engine-specific system prompt
  const engine = engineType || 'SWING'; // Default to SWING if not specified
  const systemPrompt = getEngineSystemPrompt(engine);
  
  // Build prompt with system message + context as JSON
  const userMessage = JSON.stringify({ context }, null, 2);
  const prompt = `${systemPrompt}\n\n---\n\nHere is the context:\n\n${userMessage}`;

  // Call AI using shared client
  // Use a special system UUID: 00000000-0000-0000-0000-000000000000
  console.log(`[callAIForSignalEvaluation] Calling AI for signal evaluation (task: smc_trade_setups)`);
  let response: string;
  try {
    // Add 15-second timeout to prevent hanging on rate limits
    const timeoutPromise = new Promise<string>((_, reject) => {
      setTimeout(() => reject(new Error('AI call timeout after 15s (likely rate limited)')), 15000);
    });
    
    const aiPromise = callAi({
      userId: "00000000-0000-0000-0000-000000000000", // System user UUID
      tier: "admin",
      task: "smc_trade_setups",
      prompt,
      maxTokens: 800, // Increased for institutional analysis
    });
    
    response = await Promise.race([aiPromise, timeoutPromise]);
    console.log(`[callAIForSignalEvaluation] AI response received (${response.length} chars)`);
  } catch (aiError) {
    console.error(`[callAIForSignalEvaluation] ❌ AI call failed:`, aiError);
    throw new Error(`AI evaluation failed: ${aiError instanceof Error ? aiError.message : String(aiError)}`);
  }

  // Parse AI response to AiSignalResult
  try {
    // Strip markdown code fences if present (```json ... ```)
    let cleanedResponse = response.trim();
    if (cleanedResponse.startsWith('```')) {
      // Remove opening fence (```json or ```)
      cleanedResponse = cleanedResponse.replace(/^```(?:json)?\n?/, '');
      // Remove closing fence (```)
      cleanedResponse = cleanedResponse.replace(/\n?```$/, '');
      cleanedResponse = cleanedResponse.trim();
    }
    
    const result: AiSignalResult = JSON.parse(cleanedResponse);
    
    // Validate and normalize to legacy AISignalEvaluation format
    const aiEval: AISignalEvaluation & { structured_reasons?: AiSignalResult['reasons'] } = {
      ai_decision: normalizeAIDecision(result.signal),
      ai_confidence: Math.max(0, Math.min(100, result.confidence_score || 50)),
      ai_summary: result.summary || "AI evaluation completed.",
      risk_factors: [
        result.reasons.confluence || "Confluence analysis completed",
        result.reasons.sentiment || "Sentiment analysis completed",
        result.reasons.smc || "SMC analysis completed",
      ].slice(0, 5),
      sentiment_impact: {
        direction: determineSentimentDirection(result.reasons.sentiment),
        strength: determineSentimentStrength(result.reasons.sentiment, context.sentiment_summary),
        alignment_with_technicals: determineAlignment(result.reasons.confluence, context.confluence.base_signal, result.signal),
        key_concerns: extractKeyConcerns(result.reasons),
        reasoning: result.reasons.sentiment || "Sentiment analysis completed",
      },
      entry_price: raw.quote.current_price,
      stop_loss: undefined,
      take_profit_1: undefined,
      take_profit_2: undefined,
      // Store structured reasons from AI (all strings)
      structured_reasons: result.reasons,
    };

    return aiEval;
  } catch (error) {
    console.error(`[callAIForSignalEvaluation] JSON parse error:`, error);
    console.error(`[callAIForSignalEvaluation] Raw response:`, response);
    throw new Error("Failed to parse AI response");
  }
}

// Helper: Extract sentiment direction from reasoning
function determineSentimentDirection(sentimentReason: string): "bullish" | "bearish" | "neutral" {
  const lower = sentimentReason.toLowerCase();
  if (lower.includes("bullish") && !lower.includes("not bullish")) return "bullish";
  if (lower.includes("bearish") && !lower.includes("not bearish")) return "bearish";
  return "neutral";
}

// Helper: Determine sentiment strength
function determineSentimentStrength(
  sentimentReason: string,
  summary: { bullish_count: number; bearish_count: number; neutral_count: number; aggregate_score: number }
): "strong" | "moderate" | "weak" | "none" {
  const total = summary.bullish_count + summary.bearish_count + summary.neutral_count;
  if (total === 0) return "none";
  
  const dominantPct = Math.max(summary.bullish_count, summary.bearish_count) / total;
  if (dominantPct > 0.7) return "strong";
  if (dominantPct > 0.5) return "moderate";
  return "weak";
}

// Helper: Determine alignment with technicals
function determineAlignment(
  confluenceReason: string,
  baseSignal: string,
  aiSignal: string
): "aligned" | "conflicting" | "neutral" {
  const lower = confluenceReason.toLowerCase();
  if (lower.includes("confirmed") || lower.includes("supports") || lower.includes("aligned")) {
    return baseSignal === aiSignal ? "aligned" : "conflicting";
  }
  if (lower.includes("override") || lower.includes("flip") || lower.includes("conflict")) {
    return "conflicting";
  }
  return "neutral";
}

// Helper: Extract key concerns from reasons
function extractKeyConcerns(reasons: AiSignalResult['reasons']): string[] {
  const concerns: string[] = [];
  
  if (reasons.sentiment.toLowerCase().includes("bearish") || reasons.sentiment.toLowerCase().includes("concern")) {
    concerns.push(reasons.sentiment.split('.')[0]);
  }
  if (reasons.macro.toLowerCase().includes("risk-off") || reasons.macro.toLowerCase().includes("concern")) {
    concerns.push(reasons.macro.split('.')[0]);
  }
  if (reasons.volume.toLowerCase().includes("weak") || reasons.volume.toLowerCase().includes("low")) {
    concerns.push(reasons.volume.split('.')[0]);
  }
  
  return concerns.slice(0, 3);
}

// ============================================================
// HELPER: DETERMINE TRADING STYLE
// ============================================================

function determineTradingStyle(timeframe: string): TradingStyle {
  const tf = timeframe.toLowerCase();
  if (tf === '5m' || tf === '15m' || tf === '1h') return 'daytrade';
  if (tf === '4h') return 'swing';
  return 'invest'; // 1d, 1w, etc.
}

// ============================================================
// BUILD AI SIGNAL CONTEXT (INSTITUTIONAL)
// ============================================================

function buildAiSignalContext(
  raw: RawSignalInput,
  rules: RuleSignal,
  trading_style?: TradingStyle
): AiSignalContext {
  // Use provided trading_style or determine from timeframe
  const tradingStyle = trading_style || determineTradingStyle(raw.timeframe);
  
  // Determine structure bias from SMC
  let structureBias: "bullish" | "bearish" | "sideways" = "sideways";
  if (raw.smc.bos_events.length > 0) {
    const lastBOS = raw.smc.bos_events[0];
    structureBias = lastBOS.direction === "up" ? "bullish" : "bearish";
  }
  
  // Build sentiment summary
  const sentimentSummary = {
    bullish_count: raw.news_sentiment?.bullish_count || 0,
    bearish_count: raw.news_sentiment?.bearish_count || 0,
    neutral_count: raw.news_sentiment?.neutral_count || 0,
    aggregate_score: raw.news_sentiment?.aggregate_score || 0.5,
  };
  
  // Build sentiment examples (top 3 articles)
  const sentimentExamples = (raw.news_sentiment?.most_recent || []).slice(0, 3).map(article => ({
    label: article.sentiment_label as "bullish" | "bearish" | "neutral",
    confidence: article.sentiment_score,
    reason: `"${article.headline}"`,
  }));
  
  // Build order blocks summary
  const orderBlocks = raw.smc.order_blocks.slice(0, 5).map(ob => ({
    direction: ob.direction,
    high: ob.high,
    low: ob.low,
    mitigated: ob.mitigated,
  }));
  
  // Build BOS summary
  const bosEvents = raw.smc.bos_events.slice(0, 3).map(bos => ({
    direction: bos.direction,
    price: bos.price,
    strength: bos.strength,
  }));
  
  // Build volume data
  const volumeData = {
    relative_volume: raw.volume_metrics.relative_volume,
    volume_trend: raw.volume_metrics.volume_trend,
    order_flow_bias: raw.volume_metrics.order_flow_bias,
    spike: raw.volume_metrics.volume_spike,
  };
  
  // Build volatility data (estimate from price action)
  const volatilityData = {
    regime: raw.quote.change_percent > 2 || raw.quote.change_percent < -2 ? "high" : "normal",
    price_change_percent: raw.quote.change_percent,
  };
  
  // Build support/resistance (simplified)
  const supportResistance = {
    day_high: raw.quote.day_high,
    day_low: raw.quote.day_low,
    week_52_high: raw.quote.week_52_high,
    week_52_low: raw.quote.week_52_low,
  };
  
  // Build fundamentals
  const fundamentals = {
    pe: raw.fundamentals?.pe_ratio || null,
    eps: raw.fundamentals?.eps || null,
    growth: null, // Not available in current data
    sector_strength: null, // Not available in current data
  };
  
  // Determine macro trend (placeholder - would need real macro data)
  const macro = {
    market_trend: null as "risk-on" | "risk-off" | "mixed" | null,
    notes: "Macro data not yet integrated",
  };
  
  // Build confluence summary with structured reasons
  const confluenceReasons = {
    smc: `${structureBias.toUpperCase()} structure with ${raw.smc.bos_events.length} BOS events, ${raw.smc.order_blocks.filter(ob => !ob.mitigated).length} active OBs`,
    price_action: `Price ${raw.quote.change_percent > 0 ? "up" : "down"} ${Math.abs(raw.quote.change_percent).toFixed(2)}% at $${raw.quote.current_price.toFixed(2)}`,
    volume: `${raw.volume_metrics.relative_volume.toFixed(2)}x average, ${raw.volume_metrics.volume_trend} trend, ${raw.volume_metrics.order_flow_bias} order flow`,
    volatility: volatilityData.regime === "high" ? "High volatility regime" : "Normal volatility",
    sentiment: `${sentimentSummary.bullish_count}B/${sentimentSummary.bearish_count}B/${sentimentSummary.neutral_count}N articles, ${(sentimentSummary.aggregate_score * 100).toFixed(0)}% bullish score`,
    fundamentals: raw.fundamentals?.pe_ratio 
      ? `PE ${raw.fundamentals.pe_ratio.toFixed(1)}, Market Cap $${(raw.fundamentals.market_cap! / 1e9).toFixed(1)}B`
      : "Limited fundamental data",
    macro: macro.notes,
  };
  
  return {
    symbol: raw.symbol,
    timeframe: raw.timeframe,
    trading_style: tradingStyle,
    latest_price: raw.quote.current_price,
    
    candles: [], // Simplified - OHLCV data not directly used by institutional prompt
    order_blocks: orderBlocks,
    bos: bosEvents,
    volume: volumeData,
    volatility: volatilityData,
    support_resistance: supportResistance,
    
    sentiment_summary: sentimentSummary,
    sentiment_examples: sentimentExamples,
    
    fundamentals,
    macro,
    
    confluence: {
      base_signal: rules.raw_signal_type === "neutral" ? "hold" : rules.raw_signal_type,
      confluence_score: rules.confluence_score,
      structure_bias: structureBias,
      reasons: confluenceReasons,
    },
  };
}

// ============================================================
// LEGACY: SENTIMENT TRADING STYLE RULES (kept for reference)
// ============================================================

function getSentimentTradingStyleRules(timeframe: string): string {
  const normalizedTf = timeframe.toLowerCase();
  
  if (normalizedTf === '15m' || normalizedTf === '1h') {
    // DAYTRADE style
    return `**SENTIMENT INTERPRETATION (DAYTRADE STYLE - ${timeframe}):**
News sentiment should be HIGHLY WEIGHTED for intraday trading:
- Very Bullish sentiment (>70%) → Strong case for BUY signals, especially with technical confirmation
- Very Bearish sentiment (<30%) → Strong case for SELL signals, especially with technical confirmation
- Recency is CRITICAL: Focus on news from last 12 hours; older news has minimal impact
- High-confidence bearish news can override bullish technicals for daytrades (avoid traps)
- Low article counts (<3) → sentiment is unreliable; rely more on technicals
- Conflicting sentiment + weak technicals → AVOID or downgrade to neutral
- Sentiment-momentum alignment is KEY: bullish news + bullish price action = high confidence`;
  } else if (normalizedTf === '4h') {
    // SWING style
    return `**SENTIMENT INTERPRETATION (SWING STYLE - ${timeframe}):**
News sentiment should MODERATELY influence swing trade decisions:
- Very Bullish sentiment (>65%) → Supports BUY bias but verify with multi-day trend
- Very Bearish sentiment (<35%) → Supports SELL bias but verify with multi-day trend
- Recency matters: Last 24-48 hours most relevant; older news still has some weight
- Persistent sentiment trend over multiple days is MORE valuable than single-day spikes
- Neutral technicals + strong sentiment → Cautiously consider sentiment direction
- Strong technicals + conflicting sentiment → Technicals dominate but increase risk weighting
- Sentiment can help confirm trend continuation or warn of potential reversals`;
  } else {
    // INVEST style (1d and longer)
    return `**SENTIMENT INTERPRETATION (INVEST STYLE - ${timeframe}):**
News sentiment should be LIGHTLY weighted for position trades:
- Sentiment is a SECONDARY factor; fundamentals and long-term technicals dominate
- Extreme sentiment (>80% or <20%) over 72+ hours → May indicate overreaction or genuine shift
- Short-term sentiment spikes are NOISE for position trades; ignore daily fluctuations
- Look for PERSISTENT sentiment trends over weeks, not days
- Negative sentiment on strong fundamentals → Potential value opportunity (contrarian)
- Positive sentiment on weak fundamentals → Potential overvaluation risk
- Use sentiment to gauge market psychology and timing, not trade direction
- Focus on sentiment DIVERGENCE from price action as a signal quality indicator`;
  }
}

// ============================================================
// BUILD AI PROMPT
// ============================================================

function buildAIPrompt(raw: RawSignalInput, rules: RuleSignal): string {
  const currentPrice = raw.quote.current_price;
  const priceChange = raw.quote.change_percent;

  // SMC summary
  const smcSummary = formatSMCSummary(raw);

  // Fundamentals summary
  const fundamentalsSummary = raw.fundamentals?.pe_ratio
    ? `PE: ${raw.fundamentals.pe_ratio.toFixed(1)}, Market Cap: $${(raw.fundamentals.market_cap! / 1e9).toFixed(1)}B`
    : "Limited fundamental data";

  // News sentiment summary (enhanced with AI sentiment analysis)
  const sentimentSummary = raw.news_sentiment
    ? formatSentimentForPrompt(raw.news_sentiment)
    : "NEWS SENTIMENT DATA:\n- No recent news articles found for analysis\n- Sentiment: Neutral (no data)\n- Impact: Consider technical and fundamental factors only";

  const prompt = `You are a professional trading analyst evaluating a ${rules.raw_signal_type.toUpperCase()} signal for ${raw.symbol}.

**Market Data:**
- Current Price: $${currentPrice.toFixed(2)} (${priceChange > 0 ? "+" : ""}${priceChange.toFixed(2)}%)
- Timeframe: ${raw.timeframe}

**Rule-Based Analysis:**
- Signal: ${rules.raw_signal_type.toUpperCase()}
- Confidence: ${rules.raw_confidence}%
- Confluence Score: ${rules.confluence_score}%
- SMC Confidence: ${rules.smc_confidence}%
- Volume Confidence: ${rules.volume_confidence}%
- Sentiment Confidence: ${rules.sentiment_confidence}%

**Smart Money Concepts:**
${smcSummary}

**Volume Analysis:**
- Relative Volume: ${raw.volume_metrics.relative_volume.toFixed(2)}x average
- Volume Trend: ${raw.volume_metrics.volume_trend}
- Order Flow: ${raw.volume_metrics.order_flow_bias}

**Fundamentals:**
${fundamentalsSummary}

${sentimentSummary}

${getSentimentTradingStyleRules(raw.timeframe)}

**Your Task:**
${getEvaluationInstructions(rules.confluence_score, rules.raw_signal_type)}

**IMPORTANT:** Return ONLY valid JSON in this exact format:
{
  "ai_decision": "buy|sell|hold|avoid",
  "ai_confidence": 0-100,
  "ai_summary": "2-4 sentences explaining your evaluation",
  "risk_factors": ["risk 1", "risk 2", "risk 3"],
  "sentiment_impact": {
    "direction": "bullish|bearish|neutral",
    "strength": "strong|moderate|weak|none",
    "alignment_with_technicals": "aligned|conflicting|neutral",
    "key_concerns": ["concern 1", "concern 2"],
    "reasoning": "1-2 sentences on how sentiment influenced your decision"
  },
  "entry_price": ${currentPrice.toFixed(2)} or adjusted value,
  "stop_loss": suggested stop loss price,
  "take_profit_1": first target price,
  "take_profit_2": second target price (optional)
}`;

  return prompt;
}

// ============================================================
// EVALUATION INSTRUCTIONS (CONFLUENCE-BASED)
// ============================================================

function getEvaluationInstructions(
  confluence: number,
  ruleSignal: string
): string {
  if (confluence >= STRONG_CONFLUENCE_THRESHOLD) {
    // Strong confluence: AI can only refine
    return `The rule-based signal has STRONG confluence (${confluence}%). Your role is to REFINE this ${ruleSignal.toUpperCase()} signal:
- You MAY adjust entry/stop/target prices
- You MAY downgrade confidence if you see critical risks
- You MAY suggest "hold" or "avoid" ONLY if there are severe red flags (low confidence)
- You CANNOT flip from ${ruleSignal.toUpperCase()} to the opposite direction
- Focus on risk assessment and price optimization`;
  } else if (confluence >= WEAK_CONFLUENCE_THRESHOLD) {
    // Medium confluence: AI can downgrade to neutral
    return `The rule-based signal has MEDIUM confluence (${confluence}%). Your role is to VALIDATE this ${ruleSignal.toUpperCase()} signal:
- You MAY adjust entry/stop/target prices
- You MAY downgrade to "hold" or "avoid" if you see conflicts
- You CANNOT flip to the opposite direction (${ruleSignal === "buy" ? "SELL" : "BUY"})
- If you're uncertain, choose "hold" or "avoid"`;
  } else {
    // Weak confluence: AI has full authority
    return `The rule-based signal has WEAK confluence (${confluence}%). You have FULL AUTHORITY to override:
- You MAY flip from ${ruleSignal.toUpperCase()} to the opposite direction if warranted
- You MAY choose any decision: buy, sell, hold, or avoid
- Base your decision on ALL available data, not just the rule-based signal
- Be decisive but cautious`;
  }
}

// ============================================================
// HYBRID DECISION LOGIC
// ============================================================

interface HybridDecision {
  signal_type: "buy" | "sell" | "neutral";
  confidence_score: number;
}

function applyHybridDecisionLogic(
  rules: RuleSignal,
  ai: AISignalEvaluation
): HybridDecision {
  let finalSignalType: "buy" | "sell" | "neutral" = rules.raw_signal_type;
  let finalConfidence = rules.raw_confidence;

  const confluence = rules.confluence_score;

  if (confluence >= STRONG_CONFLUENCE_THRESHOLD) {
    // Strong confluence: Lock direction, AI can only downgrade to neutral
    if ((ai.ai_decision === "avoid" || ai.ai_decision === "hold") && ai.ai_confidence >= 60) {
      // AI is strongly cautious
      finalSignalType = "neutral";
      finalConfidence = Math.min(rules.raw_confidence, 50); // Cap at 50
    } else {
      // Keep rules signal
      finalSignalType = rules.raw_signal_type;
      // Blend confidence (80% rules, 20% AI)
      finalConfidence = Math.round(rules.raw_confidence * 0.8 + ai.ai_confidence * 0.2);
    }
  } else if (confluence >= WEAK_CONFLUENCE_THRESHOLD) {
    // Medium confluence: AI can downgrade to neutral but not flip
    if (ai.ai_decision === "avoid" || ai.ai_decision === "hold") {
      finalSignalType = "neutral";
      finalConfidence = Math.min(rules.raw_confidence, ai.ai_confidence);
    } else if (ai.ai_decision === rules.raw_signal_type) {
      // AI confirms rules
      finalSignalType = rules.raw_signal_type;
      // Blend confidence (60% rules, 40% AI)
      finalConfidence = Math.round(rules.raw_confidence * 0.6 + ai.ai_confidence * 0.4);
    } else {
      // AI disagrees but can't flip
      finalSignalType = "neutral";
      finalConfidence = 40; // Low confidence due to disagreement
    }
  } else {
    // Weak confluence: AI has full authority
    if (ai.ai_decision === "buy") {
      finalSignalType = "buy";
      finalConfidence = Math.round((ai.ai_confidence + rules.raw_confidence) / 2);
    } else if (ai.ai_decision === "sell") {
      finalSignalType = "sell";
      finalConfidence = Math.round((ai.ai_confidence + rules.raw_confidence) / 2);
    } else {
      // hold or avoid
      finalSignalType = "neutral";
      finalConfidence = Math.min(rules.raw_confidence, ai.ai_confidence);
    }
  }

  // Special case: If rules was neutral, AI can choose freely
  if (rules.raw_signal_type === "neutral") {
    if (ai.ai_decision === "buy" || ai.ai_decision === "sell") {
      finalSignalType = ai.ai_decision;
      finalConfidence = ai.ai_confidence;
    }
  }

  // Clamp final confidence
  finalConfidence = Math.max(0, Math.min(100, finalConfidence));

  return { signal_type: finalSignalType, confidence_score: finalConfidence };
}

// ============================================================
// FALLBACK AI EVALUATION
// ============================================================

function createFallbackAIEvaluation(
  rules: RuleSignal,
  quote: QuoteData
): AISignalEvaluation {
  const direction = rules.raw_signal_type.toUpperCase();
  return {
    ai_decision: rules.raw_signal_type === "neutral" ? "hold" : rules.raw_signal_type,
    ai_confidence: rules.raw_confidence,
    ai_summary:
      `Hybrid AI fallback engaged: continuing with ${direction} plan (confluence ${rules.confluence_score}%). Core models timed out, so rely on rule-based levels and re-check price/volume before acting.`,
    risk_factors: [
      "AI reasoning timed out – rule engine active",
      "Confluence score: " + rules.confluence_score + "%",
    ],
    entry_price: quote.current_price,
    stop_loss: undefined,
    take_profit_1: undefined,
    take_profit_2: undefined,
  };
}

// ============================================================
// PRICE LEVEL CALCULATION
// ============================================================

interface PriceLevels {
  entry_price: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2?: number;
}

/**
 * Fallback price levels calculator (legacy method using fixed percentages)
 * Used when ATR calculation fails or insufficient data
 */
function calculatePriceLevelsFallback(
  signalType: "buy" | "sell" | "neutral",
  quote: QuoteData,
  ai: AISignalEvaluation,
  smc: any
): PriceLevels {
  const currentPrice = quote.current_price;

  // Use AI levels if provided
  if (ai.entry_price && ai.stop_loss && ai.take_profit_1) {
    return {
      entry_price: ai.entry_price,
      stop_loss: ai.stop_loss,
      take_profit_1: ai.take_profit_1,
      take_profit_2: ai.take_profit_2,
    };
  }

  // Fallback: Calculate based on signal type using fixed percentages
  if (signalType === "buy") {
    return {
      entry_price: currentPrice,
      stop_loss: currentPrice * 0.98, // 2% below
      take_profit_1: currentPrice * 1.03, // 3% above
      take_profit_2: currentPrice * 1.05, // 5% above
    };
  } else if (signalType === "sell") {
    return {
      entry_price: currentPrice,
      stop_loss: currentPrice * 1.02, // 2% above
      take_profit_1: currentPrice * 0.97, // 3% below
      take_profit_2: currentPrice * 0.95, // 5% below
    };
  } else {
    // Neutral - no actionable trade levels
    return {
      entry_price: currentPrice, // Keep current price for reference
      stop_loss: undefined as any,  // No stop loss for neutral
      take_profit_1: undefined as any,  // No target for neutral
      take_profit_2: undefined,
    };
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function normalizeAIDecision(
  decision: any
): "buy" | "sell" | "hold" | "avoid" {
  const normalized = String(decision).toLowerCase();
  if (normalized === "buy") return "buy";
  if (normalized === "sell") return "sell";
  if (normalized === "hold" || normalized === "neutral") return "hold";
  return "avoid";
}

function calculateCorrectionRisk(
  rules: RuleSignal,
  ai: AISignalEvaluation
): number {
  // Base risk: inverse of confluence
  let risk = 100 - rules.confluence_score;

  // Adjust based on AI confidence
  if (ai.ai_confidence < 50) {
    risk += 10;
  }

  // Factor in sentiment-trend alignment
  if (ai.sentiment_impact) {
    const alignment = ai.sentiment_impact.alignment_with_technicals;
    const strength = ai.sentiment_impact.strength;
    
    if (alignment === "conflicting") {
      // Sentiment conflicts with technicals -> increase risk
      if (strength === "strong") risk += 15;
      else if (strength === "moderate") risk += 10;
      else if (strength === "weak") risk += 5;
    } else if (alignment === "aligned") {
      // Sentiment aligns with technicals -> decrease risk
      if (strength === "strong") risk -= 10;
      else if (strength === "moderate") risk -= 5;
    }
    // neutral alignment doesn't change risk
  }

  // Clamp to 0-100
  return Math.max(0, Math.min(100, Math.round(risk)));
}

function formatSMCSummary(raw: RawSignalInput): string {
  const obCount = raw.smc.order_blocks.length;
  const bosCount = raw.smc.bos_events.length;

  if (bosCount === 0 && obCount === 0) {
    return "No SMC data available for this symbol/timeframe.";
  }

  const lastBOS = raw.smc.bos_events[0];
  const bosText = lastBOS
    ? `Last BOS: ${lastBOS.direction} @ $${lastBOS.price.toFixed(2)} (strength: ${lastBOS.strength}%)`
    : "No recent BOS";

  const activeOBs = raw.smc.order_blocks.filter((ob) => !ob.mitigated);
  const obText = `${activeOBs.length} active order blocks (${obCount} total detected)`;

  return `${bosText}\n${obText}`;
}

function formatSMCData(raw: RawSignalInput) {
  return {
    order_blocks: raw.smc.order_blocks.slice(0, 5).map((ob) => ({
      direction: ob.direction,
      price_range: `$${ob.low.toFixed(2)} - $${ob.high.toFixed(2)}`,
      status: ob.mitigated ? "mitigated" : "active",
    })),
    bos_events: raw.smc.bos_events.slice(0, 3).map((bos) => ({
      direction: bos.direction,
      price: bos.price,
      time: bos.event_time,
    })),
    key_level: raw.smc.order_blocks[0]
      ? `$${((raw.smc.order_blocks[0].high + raw.smc.order_blocks[0].low) / 2).toFixed(2)}`
      : undefined,
    structure_bias:
      raw.smc.bos_events[0]?.direction === "up"
        ? "bullish"
        : raw.smc.bos_events[0]?.direction === "down"
        ? "bearish"
        : "neutral",
  };
}

function formatVolumeData(raw: RawSignalInput) {
  return {
    relative_volume: raw.volume_metrics.relative_volume,
    trend: raw.volume_metrics.volume_trend,
    order_flow_bias: raw.volume_metrics.order_flow_bias,
    vwap_distance: raw.volume_metrics.vwap_distance,
  };
}

function formatSentimentData(raw: RawSignalInput) {
  const sentimentLabel =
    raw.sentiment_score > 20
      ? "bullish"
      : raw.sentiment_score < -20
      ? "bearish"
      : "neutral";

  return {
    overall: sentimentLabel,
    score: raw.sentiment_score,
    news_count: raw.news.length,
    headlines: raw.news.slice(0, 5).map((n) => n.headline),
    // Include news sentiment analytics if available
    news_sentiment: raw.news_sentiment ? {
      total_articles: raw.news_sentiment.total_articles,
      bullish_count: raw.news_sentiment.bullish_count,
      bearish_count: raw.news_sentiment.bearish_count,
      neutral_count: raw.news_sentiment.neutral_count,
      aggregate_score: raw.news_sentiment.aggregate_score,
      confidence: raw.news_sentiment.confidence,
      overall_bias: raw.news_sentiment.overall_bias,
    } : undefined,
  };
}
