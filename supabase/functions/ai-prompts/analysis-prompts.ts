/**
 * AI Prompt Templates for TradeLens AI
 * Personalized based on user persona (experience, style, interests)
 */

import type { UserPersona } from '../build-user-persona/index.ts'

/**
 * Build personalized stock/crypto analysis prompt
 * Tailors analysis to user's experience level and trading style
 */
export function buildAnalysisPrompt(
  persona: UserPersona,
  tickerInfo: any,
  newsSummary: string
): string {
  return `
You are an AI trading assistant for TradeLens AI.

User persona:
- Experience level: ${persona.experienceLevel}
- Trading style: ${persona.tradingStyle}
- Interests: ${persona.interests.join(', ') || 'none specified'}
- Regions: ${persona.regions.join(', ') || 'global'}
- Crypto enabled: ${persona.cryptoEnabled}
- Notification preference: ${persona.notificationFrequency}

Task:
Analyze the following instrument and produce a clear, concise summary and a BUY / HOLD / SELL indication tailored to this persona.

Instrument data:
${JSON.stringify(tickerInfo, null, 2)}

Recent news summary:
${newsSummary}

Personalization guidelines:
- For ${persona.experienceLevel === 'beginner' ? 'BEGINNERS: avoid jargon, explain concepts simply, focus on fundamentals' : ''}
- For ${persona.experienceLevel === 'intermediate' ? 'INTERMEDIATE: balance explanation with analysis, highlight key factors' : ''}
- For ${persona.experienceLevel === 'advanced' ? 'ADVANCED: focus on technical levels, catalysts, and tactical opportunities' : ''}
- For ${persona.experienceLevel === 'expert' ? 'EXPERTS: provide detailed technical and fundamental analysis, key levels and risk/reward' : ''}

Trading style adjustments:
- For ${persona.tradingStyle === 'long_term_builder' ? 'LONG-TERM BUILDERS: emphasize fundamentals, valuation, and multi-year outlook' : ''}
- For ${persona.tradingStyle === 'swing_trader' ? 'SWING TRADERS: emphasize medium-term price action, momentum, and 1-4 week targets' : ''}
- For ${persona.tradingStyle === 'active_trader' ? 'ACTIVE TRADERS: emphasize volatility, intraday patterns, and short-term catalysts' : ''}
- For ${persona.tradingStyle === 'opportunistic' ? 'OPPORTUNISTIC: highlight both short and long-term opportunities' : ''}

Additional notes:
- If the instrument is outside their selected regions (${persona.regions.join(', ')}), mention that.
- If any of their interests (${persona.interests.join(', ')}) apply, highlight that connection.

Return a JSON object with:
{
  "rating": "BUY" | "HOLD" | "SELL",
  "confidence": 0-100,
  "time_horizon": "intraday" | "swing" | "long_term",
  "summary": "1-2 sentences tailored to persona",
  "risks": ["...", "..."],
  "opportunities": ["...", "..."],
  "explanation": "2-3 paragraph explanation tailored to experience level and style"
}
  `.trim()
}

/**
 * Build personalized daily market "Quick Take" prompt
 * Shown on dashboard as AI summary of what matters today
 */
export function buildDailyQuickTakePrompt(
  persona: UserPersona,
  marketSnapshot: any
): string {
  return `
You are an AI market assistant for TradeLens AI.

User persona:
- Experience: ${persona.experienceLevel}
- Style: ${persona.tradingStyle}
- Interests: ${persona.interests.join(', ') || 'none'}
- Regions: ${persona.regions.join(', ') || 'global'}
- Crypto enabled: ${persona.cryptoEnabled}

Here is a snapshot of today's markets (filtered to their regions and crypto preference):
${JSON.stringify(marketSnapshot, null, 2)}

Task:
Write ONE short paragraph (2-3 sentences max) explaining:
- What matters most for this user today
- Whether today looks calm, volatile, or eventful
- If anything matches their interests or regions

Tone guidelines:
- For beginners: friendly and reassuring, avoid overwhelming them
- For intermediate: balanced and informative
- For advanced/expert: direct and tactical

Do NOT give specific trade instructions. Focus on context and what to watch.

Return as plain text (no JSON), max 3 sentences.
  `.trim()
}

/**
 * Build personalized portfolio analysis prompt
 * Analyzes user's portfolio based on their style and goals
 */
export function buildPortfolioAnalysisPrompt(
  persona: UserPersona,
  portfolioData: any
): string {
  return `
You are an AI portfolio advisor for TradeLens AI.

User persona:
- Experience: ${persona.experienceLevel}
- Style: ${persona.tradingStyle}
- Interests: ${persona.interests.join(', ') || 'none'}
- Regions: ${persona.regions.join(', ') || 'global'}

Portfolio data:
${JSON.stringify(portfolioData, null, 2)}

Task:
Analyze this portfolio and provide insights tailored to the persona:

1. Diversification: Is it well-diversified for their style?
2. Risk profile: Does it match their trading style and experience?
3. Concentration: Any over-concentration in specific sectors/regions?
4. Alignment: Does it align with their stated interests?
5. Suggestions: 1-2 actionable suggestions

Return a JSON object with:
{
  "overall_health": "strong" | "moderate" | "needs_attention",
  "diversification_score": 0-100,
  "risk_assessment": "low" | "moderate" | "high",
  "key_insights": ["...", "..."],
  "suggestions": ["...", "..."],
  "explanation": "2-3 paragraphs tailored to experience level"
}
  `.trim()
}

/**
 * Build personalized Top 10 opportunities prompt
 * Generates daily AI-ranked opportunities filtered by persona
 */
export function buildTop10OpportunitiesPrompt(
  persona: UserPersona,
  marketData: any
): string {
  return `
You are an AI opportunity finder for TradeLens AI.

User persona:
- Experience: ${persona.experienceLevel}
- Style: ${persona.tradingStyle}
- Interests: ${persona.interests.join(', ') || 'none'}
- Regions: ${persona.regions.join(', ') || 'global'}
- Crypto enabled: ${persona.cryptoEnabled}

Market data (filtered to user regions and crypto preference):
${JSON.stringify(marketData, null, 2)}

Task:
Generate the TOP 10 opportunities for today based on:
1. User's trading style (${persona.tradingStyle})
2. User's interests (${persona.interests.join(', ')})
3. Market conditions
4. Technical and fundamental factors

For each opportunity, provide:
- Ticker symbol
- Brief reasoning (1-2 sentences)
- Time horizon (matches user style)
- Confidence score (0-100)

Return a JSON array of 10 opportunities, sorted by confidence descending.
  `.trim()
}
