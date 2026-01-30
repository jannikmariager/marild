import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchBulkQuotes } from "../_shared/yahoo_v8_client.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    console.log("🚨 FORCE CLOSING ALL OPEN POSITIONS");

    // Get all open positions
    const { data: openPositions, error: posError } = await supabase
      .from("live_positions")
      .select("*");

    if (posError) {
      console.error("Error loading positions:", posError);
      throw new Error("Failed to load positions: " + posError.message);
    }

    if (!openPositions || openPositions.length === 0) {
      console.log("✅ No open positions to close");
      return new Response(
        JSON.stringify({ success: true, message: "No positions to close", closed: 0 }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`Found ${openPositions.length} open positions`);

    // Fetch current prices
    const tickers = openPositions.map((p: any) => p.ticker);
    const quotes = await fetchBulkQuotes(tickers);

    const now = new Date();
    let closedCount = 0;

    for (const pos of openPositions) {
      const quote = quotes[pos.ticker];
      const exitPrice = quote?.price ?? pos.current_price ?? pos.entry_price;
      const isLong = pos.side === "LONG" || !pos.side;
      
      const priceDiff = isLong
        ? exitPrice - pos.entry_price
        : pos.entry_price - exitPrice;
      const realizedPnl = priceDiff * pos.size_shares;
      const realizedPnlR = realizedPnl / (pos.risk_dollars || 1);

      console.log(
        `  Closing ${pos.ticker} (${pos.strategy}): ${pos.size_shares} shares @ $${exitPrice.toFixed(2)} | P&L: $${realizedPnl.toFixed(2)} (${realizedPnlR.toFixed(2)}R)`
      );

      // Insert into live_trades
      const { error: insertError } = await supabase.from("live_trades").insert({
        strategy: pos.strategy,
        ticker: pos.ticker,
        side: pos.side || "LONG",
        signal_id: pos.signal_id,
        engine_version: pos.engine_version,
        entry_timestamp: pos.entry_timestamp,
        entry_price: pos.entry_price,
        size_shares: pos.size_shares,
        notional_at_entry: pos.notional_at_entry,
        exit_timestamp: now.toISOString(),
        exit_price: exitPrice,
        exit_reason: "FORCE_CLOSED_ADMIN",
        stop_loss: pos.stop_loss,
        take_profit: pos.take_profit,
        risk_dollars: pos.risk_dollars,
        risk_r: pos.risk_r,
        realized_pnl_dollars: realizedPnl,
        realized_pnl_r: realizedPnlR,
      });

      if (insertError) {
        console.error(`  ❌ Failed to insert trade for ${pos.ticker}:`, insertError);
        continue;
      }

      // Delete from live_positions
      const { error: deleteError } = await supabase
        .from("live_positions")
        .delete()
        .eq("id", pos.id);

      if (deleteError) {
        console.error(`  ❌ Failed to delete position for ${pos.ticker}:`, deleteError);
        continue;
      }

      closedCount++;
    }

    console.log(`✅ Force closed ${closedCount} positions`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Force closed ${closedCount} positions`,
        closed: closedCount,
        positions: openPositions.map((p: any) => ({
          ticker: p.ticker,
          strategy: p.strategy,
        })),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("❌ Force close error:", error);
    return new Response(
      JSON.stringify({ error: (error as any)?.message ?? String(error) }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
