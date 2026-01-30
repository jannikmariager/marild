// AI helper for Quick Actions execution
// Calls OpenAI with structured prompts per action type

import OpenAI from "https://esm.sh/openai@4.20.1";
import { logOpenAiUsage } from "./ai_usage_logger.ts";
import type {
  QuickActionId,
  QuickActionResult,
} from "./quickActionTypes.ts";

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });

/**
 * Call OpenAI to execute a Quick Action analysis
 * Returns structured QuickActionResult JSON
 */
export async function callQuickActionAI(
  action: QuickActionId,
  context: unknown,
  userId?: string
): Promise<QuickActionResult> {
  const systemPrompt = getSystemPromptForAction(action);
  const userContent = JSON.stringify(context, null, 2);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini", // Cheap model for quick actions
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Context:\n${userContent}` },
    ],
  });

  // Log AI usage
  await logOpenAiUsage(completion, userId || 'system', `quick_action_${action}`);

  const content = completion.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as QuickActionResult;

  // Override/ensure disclaimer for safety
  parsed.disclaimer =
    "This is informational AI-generated analysis only, not financial advice. No outcomes are guaranteed. Past performance does not indicate future results.";

  // Ensure generatedAt is set
  parsed.generatedAt = parsed.generatedAt ?? new Date().toISOString();
  parsed.action = action;

  return parsed;
}

/**
 * Get system prompt for each action type
 */
function getSystemPromptForAction(action: QuickActionId): string {
  const baseInstructions = `You are TradeLens AI, a professional trading assistant.

CRITICAL RULES:
- You MUST return ONLY valid JSON matching this structure:
{
  "action": "${action}",
  "generatedAt": "ISO datetime",
  "headline": "brief overview sentence",
  "summary": "2-3 sentence summary",
  "insights": [
    {
      "id": "unique_id",
      "title": "Insight title",
      "subtitle": "optional subtitle",
      "body": "detailed explanation",
      "severity": "info|opportunity|risk|warning",
      "tags": ["tag1", "tag2"],
      "metrics": [{"label": "metric name", "value": "metric value", "hint": "optional hint"}],
      "reasons": [{"label": "Short label", "detail": "Why this was detected - longer explanation"}]
    }
  ],
  "disclaimer": "will be overridden"
}

- Be concise and actionable
- Use clear, professional language
- Avoid guarantees or promises
- Focus on data-driven insights
- Limit insights array to 3-5 items max
- Do NOT include any text outside the JSON object
`;

  const actionSpecific: Record<QuickActionId, string> = {
    "analyze-watchlist": `
${baseInstructions}

TASK: Analyze the user's watchlist and highlight TOP 3-5 most interesting stocks
- DO NOT report on every stock - only the most actionable ones
- Prioritize: biggest gainers/losers, breakout candidates, high volume movers
- Group similar stocks (e.g., "3 tech stocks showing strength")
- Each insight should focus on ONE stock or related group
- Use metrics to show: price change %, volume change, key levels
- Use reasons to explain: "Why this was detected" - technical pattern, news catalyst, sector rotation, etc.
- Keep total insights to 3-5 maximum for readability
- If watchlist has 10+ stocks, only report the top 5 most noteworthy
`,

    "find-bullish-setups": `
${baseInstructions}

TASK: Identify bullish trading setups
- Look for strong uptrends, breakouts, or bullish patterns
- Consider volume confirmation
- Highlight key support/resistance levels
- Note any bullish divergences or momentum shifts
- Rank by confidence/strength
`,

    "scan-breakouts": `
${baseInstructions}

TASK: Identify breakout opportunities
- Focus on stocks breaking key resistance levels
- Require volume confirmation
- Note consolidation patterns before breakout
- Highlight momentum and strength
- Consider sector context
`,

    "check-sector-rotation": `
${baseInstructions}

TASK: Analyze sector rotation patterns
- Identify leading and lagging sectors
- Note shifts in sector performance
- Consider market regime (risk-on vs risk-off)
- Highlight opportunities in rotating sectors
- Explain why certain sectors are moving
`,

    "review-portfolio-risk": `
${baseInstructions}

TASK: Assess portfolio risk factors
- Analyze concentration risk (sector, position size)
- Identify correlated positions
- Highlight high-volatility holdings
- Note any macro risks
- Suggest risk mitigation if needed
`,

    "find-bearish-setups": `
${baseInstructions}

TASK: Identify bearish trading setups
- Look for downtrends, breakdowns, or bearish patterns
- Consider volume confirmation
- Highlight key resistance/support levels
- Note any bearish divergences or weakness
- Rank by confidence/strength
`,

    "upcoming-earnings": `
${baseInstructions}

TASK: Analyze upcoming earnings events
- List stocks with earnings this week
- Note expected moves or options activity
- Highlight any high-risk events
- Consider recent sector performance
- Suggest preparation strategies
`,

    "find-oversold-stocks": `
${baseInstructions}

TASK: Identify oversold stocks
- Look for RSI < 30
- Check for oversold bounces or reversal setups
- Note volume patterns
- Consider support levels nearby
- Highlight potential reversal opportunities
- Set severity as "opportunity" for strong setups
`,

    "find-overbought-stocks": `
${baseInstructions}

TASK: Identify overbought stocks
- Look for RSI > 70
- Check MACD extension
- Measure distance from 20/50 EMA
- Note parabolic trend stretch
- Highlight extreme overextensions
- Set severity as "warning" for extreme overbought conditions
`,

    "detect-trend-reversals": `
${baseInstructions}

TASK: Identify bullish and bearish trend reversals
- Look for RSI inflection points
- Check MACD crossovers
- Identify divergences (bullish/bearish)
- Note failed breakdowns or reclaimed levels
- Tag clearly as "bullish reversal" or "bearish reversal"
- Include metrics showing reversal strength
`,

    "volatility-risk-regime": `
${baseInstructions}

TASK: Analyze current volatility regime
- Check VIX level and trend
- Calculate ATR percentage
- Assess market breadth
- Identify volatility compression or expansion
- Classify regime as: "High Volatility", "Low Volatility", "Expansion", or "Compression"
- Provide risk commentary and trading implications
`,

    "macro-briefing": `
${baseInstructions}

TASK: Provide AI macro briefing
- Analyze Fed rate expectations
- Review bond yields (10Y, 2Y)
- Assess USD strength
- Check liquidity trends
- Note sector macro flows
- Identify current earnings season stage
- Summarize overall macro environment
- Keep it concise (3-5 key points)
`,

    "find-momentum-leaders": `
${baseInstructions}

TASK: Identify momentum leaders
- Look for relative strength vs SPY/QQQ
- Check trend slope (steepness)
- Verify volume confirmation
- Note proximity to 52-week highs
- Rank by momentum strength
- Set severity as "opportunity" for strongest momentum
`,

    "high-short-interest": `
${baseInstructions}

TASK: Identify high short interest stocks
- Look for short float % above 15%
- Note high borrow rates if available
- Identify squeeze potential patterns
- Check recent price action for squeeze signs
- Highlight highest risk/opportunity stocks
- Set severity as "opportunity" for strong squeeze setups
`,

    "analyze-market-sentiment": `
${baseInstructions}

TASK: Analyze overall market sentiment
- Check VIX level and trend (fear gauge)
- Analyze put/call ratios
- Review market breadth indicators
- Assess Fear & Greed Index components
- Note advancing vs declining stocks
- Classify sentiment as: "Extreme Fear", "Fear", "Neutral", "Greed", or "Extreme Greed"
- Provide actionable commentary on market positioning
`,
  };

  return actionSpecific[action];
}
