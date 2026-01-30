# News Sentiment Analyzer - Prompt Enhancement

## Date: November 29, 2024

## Summary
Enhanced the AI prompt used for news sentiment classification to provide more structured guidance and improve consistency.

## Changes Made

### Before (Simple Prompt)
```
You are a financial news sentiment classifier.
Analyze the following news headline and description for a STOCK or MARKET.

Return ONLY valid JSON with NO additional text:
{
  "sentiment": "bullish" | "bearish" | "neutral",
  "confidence": 0.0-1.0,
  "reason": "one short sentence"
}

Headline: ${headline}
Description: ${description || 'N/A'}
```

### After (Enhanced Prompt)
```
You are a financial news sentiment classifier for a trading application.

Your task is to analyze a single news article and classify the impact of the information on the related stock or market.

The sentiment MUST be one of:
- "bullish"
- "bearish"
- "neutral"

Your output MUST be valid JSON with this exact structure:
{
  "sentiment": "bullish" | "bearish" | "neutral",
  "confidence": number,      // 0.0–1.0
  "reason": "string"         // one short sentence
}

Rules:
1. Evaluate the article ONLY based on the information given.
2. Consider whether the article is likely to increase or decrease investor optimism.
3. Strong positive catalysts (earnings beats, product wins, upgrades) → bullish.
4. Strong negative catalysts (downgrades, scandals, losses, regulation) → bearish.
5. Mixed or uncertain information → neutral.
6. Confidence should reflect clarity:
   - 0.8–1.0 → strong, clear signal
   - 0.5–0.79 → moderate sentiment
   - 0.3–0.49 → weak, unclear sentiment
   - <0.3 → highly uncertain
7. NEVER include anything outside the JSON.
8. NEVER include explanations outside the JSON.
9. NEVER include sentiment stronger than warranted by the text.

Now analyze the article:

Headline: "${headline}"
Description: "${description || 'N/A'}"
Source: "${source}"
Published: "${published_at}"

Return ONLY the JSON.
```

## Key Improvements

### 1. Explicit Classification Rules
- **Before:** No guidance on what constitutes bullish/bearish
- **After:** Clear examples (earnings beats → bullish, scandals → bearish)

### 2. Confidence Calibration Guidelines
- **Before:** No guidance on confidence scoring
- **After:** Structured tiers:
  - 0.8-1.0: Strong, clear signal
  - 0.5-0.79: Moderate sentiment
  - 0.3-0.49: Weak, unclear sentiment
  - <0.3: Highly uncertain

### 3. Additional Context
- **Before:** Only headline and description
- **After:** Also includes source and published date for temporal/source credibility

### 4. Stricter Output Control
- **Before:** Basic JSON request
- **After:** Multiple emphatic rules (3 separate "NEVER" rules) to prevent AI from adding commentary

### 5. Prevents Over-Confidence
- **Rule 9:** "NEVER include sentiment stronger than warranted by the text"
- Helps avoid AI being overly certain when information is ambiguous

## Expected Benefits

### 1. More Consistent Classification
- Clear rules reduce variability in how similar articles are classified
- Confidence scores will be more calibrated and meaningful

### 2. Better Calibrated Confidence
- AI will use confidence tiers more appropriately
- High confidence (0.8+) reserved for truly clear signals
- Moderate confidence (0.5-0.79) for typical news
- Low confidence (<0.5) for ambiguous/mixed news

### 3. Reduced False Positives
- Explicit rules against over-classification
- "Mixed or uncertain → neutral" catches ambiguous cases

### 4. More Reliable for Trading Decisions
- Confidence scores are actionable (daytrade rules use <3 articles as unreliable)
- High-confidence bearish news can override technicals (as designed in TradeSignal integration)

## Validation

To test the improvement, compare sentiment results before/after for the same articles:

```sql
-- Check confidence distribution after deployment
SELECT 
  sentiment_label,
  CASE 
    WHEN sentiment_score >= 0.8 THEN 'Strong (0.8-1.0)'
    WHEN sentiment_score >= 0.5 THEN 'Moderate (0.5-0.79)'
    WHEN sentiment_score >= 0.3 THEN 'Weak (0.3-0.49)'
    ELSE 'Very Weak (<0.3)'
  END as confidence_tier,
  COUNT(*) as count,
  AVG(sentiment_score) as avg_confidence
FROM news_cache
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY sentiment_label, confidence_tier
ORDER BY sentiment_label, confidence_tier;
```

**Expected:**
- More articles in "Moderate" tier (0.5-0.79)
- Fewer articles with extreme confidence unless warranted
- More "neutral" classifications for ambiguous news

## Token Usage Impact

- **Before:** ~80-100 tokens per article
- **After:** ~150-180 tokens per article (+70-80 tokens)
- **Cost increase:** ~$0.00001 per article (negligible)
- **Total daily cost (1000 articles):** ~$0.01 increase

## Deployment

**Deployed:** November 29, 2024  
**Function:** `news_sentiment_analyzer`  
**Backward Compatible:** Yes (same JSON output structure)

## Monitoring

Monitor for 48 hours post-deployment:
- [ ] Confidence score distribution (expect more moderate scores)
- [ ] Neutral classification rate (expect slight increase for ambiguous news)
- [ ] AI parsing failures (should remain near zero)
- [ ] User feedback on sentiment accuracy

## Rollback

If needed, revert to simple prompt by reverting the commit:
```bash
git revert 524209b
supabase functions deploy news_sentiment_analyzer
```

## Related Documentation

- TradeSignal sentiment integration: `/supabase/functions/_shared/NEWS_SENTIMENT_INTEGRATION.md`
- Trading-style sentiment rules: Lines 184-222 in `signal_ai_evaluator.ts`
- Test scenarios: `/supabase/functions/_shared/signal_sentiment_integration.test.md`

## Next Steps

1. ✅ Deploy enhanced prompt
2. ⏳ Monitor confidence distribution for 48 hours
3. ⏳ Validate with test articles (known sentiment)
4. ⏳ Compare signal accuracy with vs without sentiment data
5. ⏳ Iterate on prompt based on results
