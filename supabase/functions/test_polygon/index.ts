// Simple test to verify Polygon.io API key and connectivity

Deno.serve(async (req) => {
  const polygonKey = Deno.env.get('POLYGON_API_KEY');
  
  console.log('[TEST] POLYGON_API_KEY exists:', !!polygonKey);
  console.log('[TEST] POLYGON_API_KEY length:', polygonKey?.length || 0);
  
  if (!polygonKey) {
    return new Response(
      JSON.stringify({ 
        error: 'POLYGON_API_KEY not found',
        env_vars: Object.keys(Deno.env.toObject())
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    );
  }
  
  // Test API call to Polygon
  const symbol = 'AAPL';
  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromDate = startDate.toISOString().split('T')[0];
  const toDate = endDate.toISOString().split('T')[0];
  
  const url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/5/minute/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=1000&apiKey=${polygonKey}`;
  
  console.log('[TEST] Fetching from Polygon:', url.replace(polygonKey, 'KEY_HIDDEN'));
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('[TEST] Polygon response status:', response.status);
    console.log('[TEST] Polygon response:', data);
    
    return new Response(
      JSON.stringify({
        success: true,
        status: response.status,
        has_results: !!data.results,
        result_count: data.results?.length || 0,
        first_bar: data.results?.[0],
        message: data.message || 'OK'
      }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('[TEST] Error:', error);
    return new Response(
      JSON.stringify({ error: error.message, stack: error.stack }),
      { headers: { 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
