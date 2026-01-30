// Daily aggregation of data provider costs
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  try {
    // TODO: Aggregate provider costs by querying metrics from AI services
    // For now, insert placeholder daily aggregation
    const today = new Date().toISOString().split("T")[0];
    
    const providers = ["polygon.io", "finnhub", "coingecko", "openai"];
    for (const provider of providers) {
      const mockCost = Math.random() * 50;
      const mockRequests = Math.floor(Math.random() * 10000);
      
      await supabase.from("data_source_costs").insert({
        provider_name: provider,
        request_count: mockRequests,
        cost_usd: mockCost,
        period: "daily",
        timestamp: new Date().toISOString(),
      });
    }

    return new Response(JSON.stringify({ status: "ok", providers_updated: providers.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
