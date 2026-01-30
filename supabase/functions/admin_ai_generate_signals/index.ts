// Edge Function: Generate AI signals for symbols
// Endpoint: POST /functions/v1/admin_ai_generate_signals
// Purpose: Analyze tickers and generate buy/sell/hold signals with SMC + sentiment

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { sendDiscordAlert } from "../_admin_shared/discord_helper.ts";
import { assembleRawSignalInput } from "../_shared/signal_data_fetcher.ts";
import { computeRuleSignal } from "../_shared/signal_scorer.ts";
import { evaluateSignalWithAI } from "../_shared/signal_ai_evaluator.ts";
import { signalToRow, determineTradingStyle } from "../_shared/signal_types.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface SignalRequest {
  symbols: string[];
  timeframe?: string;
  includeDetails?: boolean;
}

interface SignalOutput {
  symbol: string;
  timeframe: string;
  signal_type: "buy" | "sell" | "neutral";
  ai_decision: "buy" | "sell" | "neutral";
  confidence_score: number;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const body: SignalRequest = await req.json();
    const symbols = body.symbols || [];
    const timeframe = body.timeframe || "1h";
    const includeDetails = body.includeDetails ?? false;

    if (symbols.length === 0) {
      return new Response(
        JSON.stringify({ error: "No symbols provided" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const signals: SignalOutput[] = [];

    for (const symbol of symbols) {
      try {
        // 1. Fetch all market data (OHLCV, fundamentals, news, SMC)
        const rawInput = await assembleRawSignalInput(symbol.toUpperCase(), timeframe);

        // 2. Compute rule-based signal (SMC + volume + sentiment)
        const ruleSignal = computeRuleSignal(rawInput);

        // 3. Evaluate with AI (hybrid: rules + AI refinement based on confluence)
        const evaluatedSignal = await evaluateSignalWithAI(rawInput, ruleSignal);
        
        // TEMP: Treat admin generator as SWING engine by default (can be extended later)
        (evaluatedSignal as any).engine_type = 'SWING';
        // Add trading style based on timeframe
        evaluatedSignal.trading_style = determineTradingStyle(timeframe);

        // 4. Convert to database row format (is_manual_request = false)
        const signalRecord = signalToRow(evaluatedSignal, false);

        // 5. Insert into ai_signals table
        const { error } = await supabase.from("ai_signals").insert(signalRecord);

        if (error) {
          console.error(`DB error for ${symbol}:`, error);
          await sendDiscordAlert({
            severity: "WARN",
            title: "Signal Insert Failed",
            message: `Symbol: ${symbol}`,
            context: { error: error.message },
          });
        } else {
          // Add to results array
          signals.push({
            symbol: symbol.toUpperCase(),
            timeframe,
            signal_type: evaluatedSignal.signal_type,
            ai_decision: evaluatedSignal.ai_decision,
            confidence_score: evaluatedSignal.confidence_final,
            entry_price: evaluatedSignal.entry_price,
            stop_loss: evaluatedSignal.stop_loss,
            take_profit_1: evaluatedSignal.take_profit_1,
            take_profit_2: evaluatedSignal.take_profit_2,
          });
        }
      } catch (err) {
        console.error(`Error for ${symbol}:`, err);
      }
    }

    return new Response(
      JSON.stringify({
        status: "success",
        signals_generated: signals.length,
        signals: includeDetails ? signals : [],
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error("Signal generation error:", err);
    await sendDiscordAlert({
      severity: "CRITICAL",
      title: "Signal Generation Failed",
      message: String(err),
    });

    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
