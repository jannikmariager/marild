import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    // Use chart API which is more reliable
    const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
    const response = await fetch(yahooUrl);
    
    if (!response.ok) {
      throw new Error(`Yahoo Finance API error: ${response.status}`);
    }

    const data = await response.json();
    const meta = data.chart.result[0].meta;

    // Get basic info from chart API
    const companyProfile = {
      ticker: ticker.toUpperCase(),
      name: meta.longName || meta.shortName || ticker.toUpperCase(),
      description: null, // Not available in chart API - would need quoteSummary
      sector: null, // Not available in chart API
      industry: null, // Not available in chart API  
      country: meta.exchangeTimezoneName?.includes('America') ? 'United States' : null,
      website: null,
      logo: null,
    };

    return new Response(
      JSON.stringify(companyProfile),
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
