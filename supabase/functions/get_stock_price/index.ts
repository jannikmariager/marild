import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { ticker } = await req.json();

    if (!ticker) {
      return new Response(
        JSON.stringify({ error: 'ticker is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch from Yahoo Finance API
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
    const response = await fetch(yahooUrl);
    
    if (!response.ok) {
      throw new Error(`Yahoo Finance API error: ${response.status}`);
    }

    const data = await response.json();
    const quote = data.chart.result[0];
    const meta = quote.meta;
    const indicators = quote.indicators.quote[0];
    const timestamps = quote.timestamp;

    // Get latest values
    const latestIndex = timestamps.length - 1;
    const currentPrice = meta.regularMarketPrice;
    const previousClose = meta.previousClose || meta.chartPreviousClose;
    const change = currentPrice - previousClose;
    const changePercent = (change / previousClose) * 100;

    // Market hours check (simple version - 9:30 AM to 4:00 PM ET on weekdays)
    const now = new Date();
    const hours = now.getUTCHours();
    const day = now.getUTCDay();
    const isMarketHours = day >= 1 && day <= 5 && hours >= 14 && hours < 21; // Approximate ET in UTC

    const result = {
      ticker: ticker.toUpperCase(),
      price: currentPrice,
      change: change,
      changePercent: changePercent,
      open: indicators.open[latestIndex] || meta.regularMarketOpen,
      high: meta.regularMarketDayHigh,
      low: meta.regularMarketDayLow,
      previousClose: previousClose,
      volume: meta.regularMarketVolume,
      preMarketPrice: meta.preMarketPrice || null,
      afterHoursPrice: meta.postMarketPrice || null,
      isMarketOpen: isMarketHours,
      timestamp: new Date().toISOString(),
    };

    return new Response(
      JSON.stringify(result),
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
