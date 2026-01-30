/**
 * Direct Yahoo API Test - Minimal reproduction
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  console.log('[yahoo_test] Starting direct Yahoo API test...');

  try {
    const symbol = 'AAPL';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1h&range=1d`;
    
    console.log(`[yahoo_test] Fetching: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    console.log(`[yahoo_test] Response status: ${response.status}`);
    console.log(`[yahoo_test] Response ok: ${response.ok}`);

    const data = await response.json();
    
    console.log(`[yahoo_test] Data received, checking structure...`);
    
    if (data?.chart?.result?.[0]) {
      const result = data.chart.result[0];
      const meta = result.meta;
      
      console.log(`[yahoo_test] SUCCESS!`);
      console.log(`[yahoo_test] Symbol: ${meta.symbol}`);
      console.log(`[yahoo_test] Price: $${meta.regularMarketPrice}`);
      console.log(`[yahoo_test] Currency: ${meta.currency}`);
      
      return new Response(
        JSON.stringify({
          success: true,
          symbol: meta.symbol,
          price: meta.regularMarketPrice,
          currency: meta.currency,
          timestamps_count: result.timestamp?.length || 0,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    } else {
      console.error(`[yahoo_test] Invalid data structure`);
      console.error(`[yahoo_test] Data:`, JSON.stringify(data).substring(0, 500));
      
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Invalid data structure',
          data_preview: JSON.stringify(data).substring(0, 200),
        }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

  } catch (error) {
    console.error('[yahoo_test] Error:', error);
    console.error('[yahoo_test] Error name:', error.name);
    console.error('[yahoo_test] Error message:', error.message);
    console.error('[yahoo_test] Error stack:', error.stack);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        error_name: error.name,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
