# News Sentiment Integration Test Scenarios

## Overview
This document defines test scenarios for validating the News Sentiment integration into the TradeSignal AI evaluation pipeline.

## Test Data Setup

### Symbol: AAPL
- Timeframes: 15m, 4h, 1d
- Mock Technical Signal: BUY with 65% confluence

## Test Scenarios

### Scenario 1: Daytrade (15m) - Strong Bullish Sentiment + Bullish Technicals
**Input:**
- Timeframe: 15m
- Technical Signal: BUY (confluence: 65%)
- News Sentiment:
  - Total articles: 8
  - Bullish: 7, Bearish: 0, Neutral: 1
  - Aggregate score: 87.5% (Very Bullish)
  - Confidence: 85%
  - Recent headlines (last 12 hours):
    - "Apple announces breakthrough AI chip" (Bullish, 92%)
    - "AAPL stock surges on strong earnings beat" (Bullish, 88%)
    - "Analyst upgrades Apple to Strong Buy" (Bullish, 90%)

**Expected AI Response:**
- Decision: BUY
- Confidence: 75-85% (boosted by sentiment alignment)
- Sentiment Impact:
  - Direction: bullish
  - Strength: strong
  - Alignment: aligned
  - Key Concerns: [] (minimal concerns)
  - Reasoning: "Very bullish sentiment strongly supports the technical BUY signal. Recent high-confidence news about AI breakthroughs and earnings beat reinforce bullish momentum for intraday trading."
- Correction Risk: 20-30% (reduced due to sentiment alignment)

---

### Scenario 2: Daytrade (15m) - Strong Bearish Sentiment + Bullish Technicals
**Input:**
- Timeframe: 15m
- Technical Signal: BUY (confluence: 55%)
- News Sentiment:
  - Total articles: 6
  - Bullish: 1, Bearish: 5, Neutral: 0
  - Aggregate score: 20% (Very Bearish)
  - Confidence: 80%
  - Recent headlines (last 12 hours):
    - "Apple faces DOJ antitrust lawsuit" (Bearish, 88%)
    - "AAPL suppliers warn of production cuts" (Bearish, 75%)
    - "Analyst warns of iPhone demand weakness" (Bearish, 82%)

**Expected AI Response:**
- Decision: HOLD or AVOID (sentiment overrides weak technical BUY)
- Confidence: 35-45% (downgraded due to conflicting sentiment)
- Sentiment Impact:
  - Direction: bearish
  - Strength: strong
  - Alignment: conflicting
  - Key Concerns: ["Strong bearish news conflicts with bullish technicals", "Recent DOJ lawsuit poses significant risk"]
  - Reasoning: "Very bearish sentiment strongly conflicts with technical BUY signal. For intraday trading, high-confidence negative news about lawsuits and production cuts suggests avoiding long positions despite bullish technicals."
- Correction Risk: 65-75% (increased due to sentiment conflict)

---

### Scenario 3: Swing Trade (4h) - Moderate Bullish Sentiment + Bullish Technicals
**Input:**
- Timeframe: 4h
- Technical Signal: BUY (confluence: 70%)
- News Sentiment:
  - Total articles: 12
  - Bullish: 7, Bearish: 2, Neutral: 3
  - Aggregate score: 65% (Moderately Bullish)
  - Confidence: 70%
  - Recent headlines (last 48 hours):
    - "Apple expands services revenue" (Bullish, 72%)
    - "AAPL sees increased institutional buying" (Bullish, 68%)
    - "Concerns over China market persist" (Bearish, 65%)

**Expected AI Response:**
- Decision: BUY
- Confidence: 70-75% (moderately boosted by sentiment)
- Sentiment Impact:
  - Direction: bullish
  - Strength: moderate
  - Alignment: aligned
  - Key Concerns: ["China market concerns persist"]
  - Reasoning: "Moderately bullish sentiment supports the strong technical BUY signal. While there are some concerns about China, the overall sentiment trend over 48 hours confirms bullish bias for swing trading."
- Correction Risk: 25-35% (slightly reduced)

---

### Scenario 4: Swing Trade (4h) - Conflicting Sentiment + Strong Bullish Technicals
**Input:**
- Timeframe: 4h
- Technical Signal: BUY (confluence: 72%)
- News Sentiment:
  - Total articles: 10
  - Bullish: 4, Bearish: 5, Neutral: 1
  - Aggregate score: 42% (Neutral/Slightly Bearish)
  - Confidence: 65%
  - Recent headlines (last 48 hours):
    - "Apple stock rallies on buyback news" (Bullish, 75%)
    - "Analysts divided on AAPL outlook" (Neutral, 50%)
    - "Supply chain disruptions impact Apple" (Bearish, 70%)
    - "iPhone sales disappoint in key markets" (Bearish, 68%)

**Expected AI Response:**
- Decision: BUY (technicals dominate but with caution)
- Confidence: 60-68% (slightly downgraded)
- Sentiment Impact:
  - Direction: neutral
  - Strength: moderate
  - Alignment: conflicting
  - Key Concerns: ["Mixed sentiment creates uncertainty", "Supply chain and sales concerns offset positive news"]
  - Reasoning: "Conflicting sentiment with mixed bullish and bearish news. For swing trading, strong technicals dominate, but increased caution is warranted due to supply chain and sales concerns."
- Correction Risk: 35-45% (moderately increased)

---

### Scenario 5: Position Trade (1d) - Extreme Bearish Sentiment + Strong Bullish Fundamentals
**Input:**
- Timeframe: 1d
- Technical Signal: BUY (confluence: 68%)
- Fundamentals: PE 28, Strong cash flow, Market leader
- News Sentiment:
  - Total articles: 20
  - Bullish: 2, Bearish: 15, Neutral: 3
  - Aggregate score: 18% (Very Bearish)
  - Confidence: 75%
  - Recent headlines (last 72 hours):
    - "Apple faces regulatory pressure in EU" (Bearish, 80%)
    - "Market fears iPhone cycle slowdown" (Bearish, 78%)
    - "Competitive threats from Android intensify" (Bearish, 72%)

**Expected AI Response:**
- Decision: BUY (contrarian opportunity - fundamentals strong, sentiment overreaction)
- Confidence: 65-70%
- Sentiment Impact:
  - Direction: bearish
  - Strength: strong
  - Alignment: conflicting
  - Key Concerns: ["Regulatory pressure in EU", "iPhone cycle concerns"]
  - Reasoning: "Extreme bearish sentiment conflicts with strong fundamentals and technicals. For position trading, this may represent a contrarian value opportunity if negative sentiment is an overreaction. Strong fundamentals suggest long-term resilience."
- Correction Risk: 30-40% (fundamentals offset sentiment risk)

---

### Scenario 6: Position Trade (1d) - Low News Volume (No Sentiment Data)
**Input:**
- Timeframe: 1d
- Technical Signal: BUY (confluence: 62%)
- News Sentiment:
  - Total articles: 0
  - Aggregate score: 50% (neutral/no data)
  - Confidence: 0%

**Expected AI Response:**
- Decision: BUY (based on technicals/fundamentals only)
- Confidence: 60-65%
- Sentiment Impact:
  - Direction: neutral
  - Strength: none
  - Alignment: neutral
  - Key Concerns: []
  - Reasoning: "No recent news sentiment data available. Decision based purely on technical and fundamental analysis."
- Correction Risk: 35-40% (baseline risk)

---

### Scenario 7: Daytrade (15m) - Low Article Count with Conflicting Signals
**Input:**
- Timeframe: 15m
- Technical Signal: SELL (confluence: 58%)
- News Sentiment:
  - Total articles: 2
  - Bullish: 1, Bearish: 1, Neutral: 0
  - Aggregate score: 50% (Neutral)
  - Confidence: 60%

**Expected AI Response:**
- Decision: AVOID or HOLD
- Confidence: 30-40% (unreliable sentiment + weak confluence)
- Sentiment Impact:
  - Direction: neutral
  - Strength: weak
  - Alignment: neutral
  - Key Concerns: ["Insufficient news volume for reliable sentiment", "Low article count makes sentiment unreliable"]
  - Reasoning: "Very low article count (2) makes sentiment unreliable for intraday trading. With weak technical confluence and no clear sentiment direction, avoiding the trade is prudent."
- Correction Risk: 60-70% (high due to uncertainty)

---

## Validation Criteria

For each scenario, validate:

1. **Sentiment Data Propagation:**
   - Raw signal input includes `news_sentiment` field
   - AI prompt includes formatted sentiment summary
   - Trading-style-specific rules are included in prompt

2. **AI Response Structure:**
   - `sentiment_impact` field is present and properly structured
   - All required fields (direction, strength, alignment, key_concerns, reasoning) are populated
   - Sentiment impact reasoning is contextual and specific

3. **Decision Logic:**
   - AI decision respects trading style rules (daytrade: high weight, swing: moderate, invest: low)
   - Confidence adjustments reflect sentiment alignment/conflict
   - Correction risk is adjusted based on sentiment-trend alignment

4. **Reasons Structure:**
   - `reasons.sentiment` object is populated with:
     - Article counts (total, bullish, bearish)
     - Aggregate score and confidence
     - Key concerns from AI
     - AI reasoning
     - Recent headlines sample

5. **Admin UI Readiness:**
   - All sentiment data is available in the `reasons` structure for display
   - Data format is consistent and displayable

## Running Tests

### Manual Testing
1. Deploy updated Edge Functions:
   ```bash
   supabase functions deploy signal_news_sentiment
   supabase functions deploy evaluate_signals_daily
   ```

2. Populate test data in `news_cache`:
   ```sql
   -- Insert test news articles for AAPL for each scenario
   ```

3. Trigger signal evaluation for test symbols:
   ```bash
   # Via Admin UI or direct function call
   ```

4. Inspect results:
   - Check `ai_signals` table for populated `reasons.sentiment` field
   - Verify correction_risk adjustments
   - Review AI decision alignment with sentiment

### Automated Testing (Future)
- Create unit tests for `getSentimentTradingStyleRules()`
- Mock AI responses for deterministic testing
- Validate sentiment impact parsing
- Test correction risk calculation with various sentiment alignments

## Success Metrics

- [ ] All 7 scenarios produce expected AI decisions within confidence ranges
- [ ] Sentiment impact is correctly classified (aligned/conflicting/neutral)
- [ ] Correction risk adjustments follow expected patterns
- [ ] Trading style rules are respected (daytrade > swing > invest weighting)
- [ ] Low article counts (<3) are flagged as unreliable
- [ ] Contrarian opportunities are identified in invest style with strong fundamentals
- [ ] Sentiment data is fully available in `reasons` structure for Admin UI display
