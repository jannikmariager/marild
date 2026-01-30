/**
 * Get Stock News Edge Function
 * Returns news articles for a ticker with sentiment analysis
 * 
 * MIGRATED: Now uses yahoo_v8_client.ts (2025-11-29)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { fetchNews } from '../_shared/yahoo_v8_client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { ticker, limit = 20 } = await req.json();

    if (!ticker) {
      return new Response(
        JSON.stringify({ error: 'ticker is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch news using yahoo_v8_client (includes caching)
    const newsItems = await fetchNews(ticker, limit);

    // Transform to existing format with sentiment analysis
    const articles = newsItems.map((item) => ({
      id: item.url || String(Math.random()),
      headline: item.title,
      summary: item.summary,
      content: null, // Yahoo doesn't provide full content
      source: item.source || 'Yahoo Finance',
      author: null,
      publishedAt: item.publishedAt,
      imageUrl: null, // Not provided by simplified API
      url: item.url,
      sentiment: _analyzeSentiment(item.title + ' ' + (item.summary || '')),
      aiSummary: null, // Can be generated with AI later
    }));

    return new Response(
      JSON.stringify(articles),
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

// Simple sentiment analysis based on keywords
function _analyzeSentiment(text: string): string {
  const lower = text.toLowerCase();
  
  const bullishWords = ['surge', 'soar', 'rally', 'gain', 'bull', 'upgrade', 'beat', 'growth', 'profit', 'strong'];
  const bearishWords = ['crash', 'plunge', 'fall', 'drop', 'bear', 'downgrade', 'miss', 'loss', 'weak', 'decline'];
  
  let bullishCount = 0;
  let bearishCount = 0;
  
  bullishWords.forEach(word => {
    if (lower.includes(word)) bullishCount++;
  });
  
  bearishWords.forEach(word => {
    if (lower.includes(word)) bearishCount++;
  });
  
  if (bullishCount > bearishCount) return 'bullish';
  if (bearishCount > bullishCount) return 'bearish';
  return 'neutral';
}
