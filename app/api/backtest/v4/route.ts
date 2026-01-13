import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabaseServer";
import {
  BacktestEngineType,
  BacktestV4Request,
  BacktestV4Response,
  BacktestV4SymbolResult,
} from "@/lib/backtest/types_v4";

function getDefaultTimeframes(engine: BacktestEngineType, horizonDays?: number): string[] {
  // DAYTRADER: avoid loading huge 1m histories for long horizons to stay within
  // Edge Function memory limits. Use finer data only for very short tests.
  if (engine === "DAYTRADER") {
    if (!horizonDays || horizonDays <= 5) {
      // Very short intraday window → allow 1m
      return ["1m", "3m", "5m"];
    }
    if (horizonDays <= 10) {
      // Medium window → start at 3m/5m
      return ["3m", "5m", "15m"];
    }
    // 30d+ horizons → start at 5m to keep bar counts and memory usage reasonable
    return ["5m", "15m", "30m"];
  }

  // SWING / INVESTOR: unchanged defaults
  switch (engine) {
    case "SWING":
      return ["4h"];
    case "INVESTOR":
      return ["1d"];
    default:
      return ["1d"];
  }
}

export async function POST(req: NextRequest) {
  try {
    const payload = (await req.json()) as BacktestV4Request;

    if (!payload.engine_type || !payload.horizon_days || !Array.isArray(payload.tickers)) {
      return NextResponse.json({ error: "INVALID_REQUEST" }, { status: 400 });
    }

    if (payload.tickers.length === 0) {
      return NextResponse.json({ error: "NO_TICKERS" }, { status: 400 });
    }

    const engineType = payload.engine_type;
    const horizonDays = payload.horizon_days;
    const timeframePriority = getDefaultTimeframes(engineType, horizonDays);

    const supabase = await createServerClient();

    const results: BacktestV4SymbolResult[] = [];

    for (const rawSymbol of payload.tickers) {
      const symbol = rawSymbol.toUpperCase();

      try {
        const { data, error } = await supabase.functions.invoke<any>("run_backtest_v4", {
          body: {
            symbol,
            engine_type: engineType,
            horizon_days: horizonDays,
            timeframe_priority: timeframePriority,
          },
        });

        if (error || !data) {
          // Normalize Supabase Edge Function errors so the UI can display
          // meaningful, domain-specific messages instead of the generic
          // "Edge Function returned a non-2xx status code" string.
          let normalizedError = "EDGE_FUNCTION_ERROR";

          if (error) {
            const edgeError: any = error;
            const ctx: any = edgeError?.context;
            let ctxError: string | undefined;
            let ctxMessage: string | undefined;

            // Supabase v2 exposes the raw fetch Response as `context`.
            // Try to parse its JSON body to extract our { error, message }.
            if (ctx && typeof ctx.json === "function") {
              try {
                const body = await ctx.json();
                if (body) {
                  if (typeof body.error === "string") ctxError = body.error;
                  if (typeof body.message === "string") ctxMessage = body.message;
                }
              } catch {
                // Ignore JSON parse errors and fall back to generic info below.
              }
            }

            if (typeof ctxError === "string" && ctxError.length > 0) {
              normalizedError = ctxError;
            } else if (typeof ctxMessage === "string" && ctxMessage.length > 0) {
              normalizedError = ctxMessage;
            } else if (typeof edgeError.message === "string" && edgeError.message.length > 0) {
              // Avoid leaking Supabase's generic string if we can; keep it
              // only as an ultimate fallback.
              normalizedError = edgeError.message;
            }

            console.error("[/api/backtest/v4] Edge Function error for", symbol, {
              message: edgeError.message,
              contextStatus: ctx?.status,
            });
          } else if (!data) {
            normalizedError = "NO_DATA";
          }

          results.push({
            symbol,
            engine_type: engineType,
            timeframe_used: "",
            bars_loaded: 0,
            trades_total: 0,
            win_rate: 0,
            avg_r: 0,
            max_drawdown: 0,
            equity_ok: false,
            fallback_used: false,
            anomalies: [],
            error: normalizedError,
          });
          continue;
        }

        const stats = data.stats ?? {};
        const equityCurve = stats.equity_curve as Array<{ t: number; balance: number }> | undefined;

        let equityOk: boolean | undefined;
        if (equityCurve && Array.isArray(equityCurve)) {
          equityOk = equityCurve.every((pt) => Number.isFinite(pt.balance));
        }

        const symbolResult: BacktestV4SymbolResult = {
          symbol: data.ticker ?? symbol,
          engine_type: engineType,
          timeframe_used: data.timeframe_used,
          bars_loaded: data.bars_loaded,
          trades_total: stats.trades_total ?? (Array.isArray(data.trades) ? data.trades.length : 0),
          win_rate: stats.win_rate ?? 0,
          avg_r: stats.avg_r ?? 0,
          max_drawdown: stats.max_drawdown ?? 0,
          equity_ok: equityOk,
          fallback_used: data.fallback_used ?? false,
          anomalies: data.anomalies ?? [],
          stats_full: stats,
          trades: data.trades ?? [],
        };

        results.push(symbolResult);
      } catch (err: any) {
        const edgeError: any = err;
        const ctx: any = edgeError?.context;
        let ctxError: string | undefined;
        let ctxMessage: string | undefined;

        if (ctx && typeof ctx.json === "function") {
          try {
            const body = await ctx.json();
            if (body) {
              if (typeof body.error === "string") ctxError = body.error;
              if (typeof body.message === "string") ctxMessage = body.message;
            }
          } catch {
            // ignore
          }
        }

        let normalizedError = "EDGE_FUNCTION_ERROR";
            const status = ctx?.status as number | undefined;

            if (typeof ctxError === "string" && ctxError.length > 0) {
              normalizedError = ctxError;
            } else if (typeof ctxMessage === "string" && ctxMessage.length > 0) {
              normalizedError = ctxMessage;
            } else if (typeof status === "number") {
              // Map common HTTP statuses from run_backtest_v4
              if (status === 404) {
                normalizedError = "DATA_UNAVAILABLE";
              } else if (status === 400) {
                normalizedError = "UNAPPROVED_TICKER";
              } else if (status >= 500) {
                normalizedError = "INTERNAL_ERROR";
              } else {
                normalizedError = "EDGE_FUNCTION_ERROR";
              }
            } else {
              // Last-resort generic message; do NOT leak Supabase's
              // internal string, just show a neutral failure.
              normalizedError = "EDGE_FUNCTION_ERROR";
            }

            console.error("[/api/backtest/v4] Edge Function error for", symbol, {
              message: edgeError.message,
              contextStatus: status,
            });
        results.push({
          symbol,
          engine_type: engineType,
          timeframe_used: "",
          bars_loaded: 0,
          trades_total: 0,
          win_rate: 0,
          avg_r: 0,
          max_drawdown: 0,
          equity_ok: false,
          fallback_used: false,
          anomalies: [],
          error: normalizedError,
        });
      }
    }

    const response: BacktestV4Response = {
      horizon_days: horizonDays,
      timeframe_priority: timeframePriority,
      results,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: any) {
    console.error("[/api/backtest/v4] Unexpected error:", err);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: err?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
