import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAi } from "../shared/ai_client.ts";
import { getSubscriptionStatusFromRequest, hasProAccess, createLockedResponse } from "../_shared/subscription_checker.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { ticker, priceData, fundamentals, news, userId, tier } = await req.json();

    if (!ticker) {
      return new Response(
        JSON.stringify({ error: 'ticker is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check PRO access
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const subscriptionStatus = await getSubscriptionStatusFromRequest(supabase, req);
    
    if (!hasProAccess(subscriptionStatus)) {
      return createLockedResponse();
    }

    // Construct context for AI
    const context = {
      ticker: ticker.toUpperCase(),
      currentPrice: priceData?.price || null,
      changePercent: priceData?.changePercent || null,
      marketCap: fundamentals?.marketCap || null,
      peRatio: fundamentals?.peRatio || null,
      recentNews: news?.slice(0, 5).map((n: any) => ({
        headline: n.headline,
        sentiment: n.sentiment,
      })) || [],
    };

    const prompt = `Analyze ${context.ticker} stock and provide comprehensive AI insights in the following JSON format:

{
  "summary": "2-3 sentence overview of the stock's current position and outlook",
  "sentiment": "bullish|neutral|bearish",
  "sentimentScore": 0-100,
  "riskSignals": [
    {"title": "Signal name", "description": "Brief description", "severity": "high|medium|low"}
  ],
  "trendClassification": {
    "shortTerm": "bullish|neutral|bearish",
    "longTerm": "bullish|neutral|bearish"
  },
  "fairPrice": {
    "estimate": number,
    "confidence": "high|medium|low",
    "reasoning": "Brief explanation"
  }
}

Context:
- Current Price: $${context.currentPrice}
- Change: ${context.changePercent?.toFixed(2)}%
- Market Cap: $${context.marketCap ? (context.marketCap / 1e9).toFixed(2) + 'B' : 'N/A'}
- P/E Ratio: ${context.peRatio || 'N/A'}
- Recent News Sentiment: ${context.recentNews.map((n: any) => n.sentiment).join(', ')}

Be concise and actionable.`;

    const response = await callAi({
      userId: userId || 'anonymous',
      tier: tier || 'trial',
      task: 'short_snippet',
      prompt: prompt,
      cacheKey: `ai_insights:${ticker.toUpperCase()}:${new Date().toISOString().split('T')[0]}`,
      maxTokens: 500,
    });

    // Parse the AI response
    let insights;
    try {
      insights = JSON.parse(response);
    } catch (e) {
      // If parsing fails, return a structured error
      console.error('Failed to parse AI response:', e);
      insights = {
        summary: response.substring(0, 200),
        sentiment: 'neutral',
        sentimentScore: 50,
        riskSignals: [],
        trendClassification: { shortTerm: 'neutral', longTerm: 'neutral' },
        fairPrice: { estimate: context.currentPrice, confidence: 'low', reasoning: 'Unable to analyze' }
      };
    }

    return new Response(
      JSON.stringify(insights),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
