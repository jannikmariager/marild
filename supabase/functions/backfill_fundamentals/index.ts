import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FINNHUB_KEY = Deno.env.get("FINNHUB_API_KEY");
const FMP_KEY = Deno.env.get("FMP_API_KEY");

Deno.serve(async (req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  
  console.log("🔧 Backfilling fundamentals...");
  
  // Fetch fundamentals
  async function fetchFundamentals(symbol: string): Promise<any> {
    if (FINNHUB_KEY) {
      try {
        const response = await fetch(
          `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${FINNHUB_KEY}`
        );
        if (response.ok) {
          const data = await response.json();
          const metrics = data.metric;
          if (metrics && Object.keys(metrics).length > 0) {
            return {
              ticker: symbol,
              market_cap: metrics.marketCapitalization || null,
              pe_ratio: metrics.peBasicExclExtraTTM || metrics.peNormalizedAnnual || null,
              eps: metrics.epsBasicExclExtraItemsTTM || null,
              dividend_yield: metrics.dividendYieldIndicatedAnnual || null,
              beta: metrics.beta || null,
              revenue_per_share: metrics.revenuePerShareTTM || null,
              book_value_per_share: metrics.bookValuePerShareAnnual || null,
              profit_margin: metrics.netProfitMarginTTM || null,
              return_on_equity: metrics.roeTTM || null,
              shares_outstanding: metrics.sharesOutstanding || null,
            };
          }
        }
      } catch {}
    }
    if (FMP_KEY) {
      try {
        const response = await fetch(
          `https://financialmodelingprep.com/api/v3/key-metrics-ttm/${symbol}?apikey=${FMP_KEY}`
        );
        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0) {
            const metrics = data[0];
            return {
              ticker: symbol,
              market_cap: metrics.marketCapTTM || null,
              pe_ratio: metrics.peRatioTTM || null,
              eps: metrics.netIncomePerShareTTM || null,
              dividend_yield: metrics.dividendYieldTTM || null,
              beta: metrics.betaTTM || null,
              revenue_per_share: metrics.revenuePerShareTTM || null,
              book_value_per_share: metrics.bookValuePerShareTTM || null,
              profit_margin: metrics.netProfitMarginTTM || null,
              return_on_equity: metrics.roeTTM || null,
              shares_outstanding: metrics.sharesOutstandingTTM || null,
            };
          }
        }
      } catch {}
    }
    return null;
  }
  
  const { data: signals } = await supabase.from("ai_signals").select("symbol").order("symbol");
  const uniqueSymbols = [...new Set(signals.map((s: any) => s.symbol))];
  
  let successCount = 0;
  let skipCount = 0;
  
  for (const symbol of uniqueSymbols) {
    const fundamentals = await fetchFundamentals(symbol);
    if (fundamentals && Object.keys(fundamentals).length > 1) {
      await supabase.from("ai_signals").update({ fundamentals }).eq("symbol", symbol);
      successCount++;
    } else {
      skipCount++;
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  
  return new Response(JSON.stringify({ 
    success: successCount, 
    skipped: skipCount, 
    total: uniqueSymbols.length 
  }), { headers: { "Content-Type": "application/json" } });
});
