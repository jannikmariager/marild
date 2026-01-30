import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { fetchPositionBars } from "../_shared/yahoo_v8_client.ts";

/**
 * Live Position Monitor - High-frequency position monitoring
 *
 * Runs every 1 minute to:
 * - Fetch 1m bars for open positions (with 5m fallback)
 * - Check intrabar TP/SL hits
 * - Update trailing stops
 * - Update current prices and unrealized P&L
 * - Close positions on exit conditions
 *
 * Does NOT open new positions - that's handled by model_portfolio_manager
 */

interface Position {
  id: number;
  strategy: string;
  ticker: string;
  side: "LONG" | "SHORT";
  signal_id: string;
  entry_price: number;
  size_shares: number;
  notional_at_entry: number;
  stop_loss: number;
  take_profit: number;
  risk_dollars: number;
  risk_r: number;
  current_price: number | null;
  trailing_stop_active?: boolean;
  highest_price_reached?: number;
  lowest_price_reached?: number;
  trailing_stop_price?: number;
  entry_timestamp: string;
  engine_version: string;
}

interface StrategyConfig {
  strategy: string;
  trailing_stop: {
    enabled: boolean;
    activation_threshold_R: number;
    trail_distance_R: number;
  };
}

const CONFIGS: Record<string, StrategyConfig> = {
  DAYTRADE: {
    strategy: "DAYTRADE",
    trailing_stop: {
      enabled: true,
      activation_threshold_R: 1.0,
      trail_distance_R: 0.5,
    },
  },
  SWING: {
    strategy: "SWING",
    trailing_stop: {
      enabled: true,
      activation_threshold_R: 1.5,
      trail_distance_R: 0.75,
    },
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    console.log("🔄 Live Position Monitor - Starting");
    const now = new Date();

    // Load all open positions
    const { data: allPositions, error: posError } = await supabase
      .from("live_positions")
      .select("*");

    if (posError) {
      console.error("Error loading positions:", posError);
      throw new Error(`Failed to load positions: ${posError.message}`);
    }

    if (!allPositions || allPositions.length === 0) {
      console.log("No open positions to monitor");
      return new Response(
        JSON.stringify({
          success: true,
          message: "No positions",
          monitored: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`📊 Monitoring ${allPositions.length} open positions`);

    // Group by strategy
    const positionsByStrategy = allPositions.reduce((acc, pos) => {
      if (!acc[pos.strategy]) acc[pos.strategy] = [];
      acc[pos.strategy].push(pos);
      return acc;
    }, {} as Record<string, Position[]>);
    const uniqueTickers = Array.from(
      new Set(allPositions.map((p) => p.ticker.trim().toUpperCase())),
    );
    const realtimeQuotes = await loadRealtimeQuotesMap(supabase, uniqueTickers);

    let totalMonitored = 0;
    let totalExits = 0;

    // Process each strategy's positions
    for (const [strategy, positions] of Object.entries(positionsByStrategy)) {
      const config = CONFIGS[strategy];
      if (!config) {
        console.warn(`No config for strategy ${strategy}, skipping`);
        continue;
      }

      console.log(`\n📈 Processing ${positions.length} ${strategy} positions`);

      // Fetch bars for all tickers in parallel
      const tickers = positions.map((p) => p.ticker);
      const barsPromises = tickers.map((ticker) => fetchPositionBars(ticker));
      const barsResults = await Promise.all(barsPromises);

      // Create map of ticker -> bars
      const barsMap = new Map<string, typeof barsResults[0]>();
      for (let i = 0; i < tickers.length; i++) {
        if (barsResults[i]) {
          barsMap.set(tickers[i], barsResults[i]);
        }
      }

      // Process each position
      for (const pos of positions) {
        totalMonitored++;

        const barsData = barsMap.get(pos.ticker);
        const realtimeQuote = realtimeQuotes.get(
          pos.ticker.trim().toUpperCase(),
        );
        if (!barsData && !realtimeQuote) {
          console.warn(`  ⚠️ ${pos.ticker}: No price data available, skipping`);
          continue;
        }

        const currentPrice = realtimeQuote?.price ?? barsData?.currentPrice ??
          null;
        if (!currentPrice) {
          console.warn(`  ⚠️ ${pos.ticker}: No current price, skipping`);
          continue;
        }

        const isLong = pos.side === "LONG";
        const priceDiff = isLong
          ? currentPrice - pos.entry_price
          : pos.entry_price - currentPrice;
        const unrealizedPnl = priceDiff * pos.size_shares;
        const unrealizedPnlR = unrealizedPnl / pos.risk_dollars;

        console.log(
          `  ${pos.ticker} (${pos.side}): Entry=$${
            pos.entry_price.toFixed(2)
          } Current=$${currentPrice.toFixed(2)} P&L=${
            unrealizedPnlR.toFixed(2)
          }R ($${unrealizedPnl.toFixed(2)})`,
        );

        // Trailing stop logic
        let trailingStopActive = pos.trailing_stop_active || false;
        let highestPrice = pos.highest_price_reached || pos.entry_price;
        let lowestPrice = pos.lowest_price_reached || pos.entry_price;
        let trailingStopPrice = pos.trailing_stop_price;
        let updatedStopLoss = pos.stop_loss;

        if (config.trailing_stop.enabled) {
          const riskPerShare = Math.abs(pos.entry_price - pos.stop_loss);

          if (isLong) {
            if (currentPrice > highestPrice) {
              highestPrice = currentPrice;
            }

            if (
              !trailingStopActive &&
              unrealizedPnlR >= config.trailing_stop.activation_threshold_R
            ) {
              trailingStopActive = true;
              console.log(
                `    📈 Trailing stop ACTIVATED at ${
                  unrealizedPnlR.toFixed(2)
                }R`,
              );
            }

            if (trailingStopActive) {
              trailingStopPrice = highestPrice -
                (config.trailing_stop.trail_distance_R * riskPerShare);
              if (trailingStopPrice > updatedStopLoss) {
                updatedStopLoss = trailingStopPrice;
                console.log(
                  `    ↗️  Trailing SL updated to $${
                    updatedStopLoss.toFixed(2)
                  }`,
                );
              }
            }
          } else {
            // SHORT
            if (currentPrice < lowestPrice) {
              lowestPrice = currentPrice;
            }

            if (
              !trailingStopActive &&
              unrealizedPnlR >= config.trailing_stop.activation_threshold_R
            ) {
              trailingStopActive = true;
              console.log(
                `    📉 Trailing stop ACTIVATED at ${
                  unrealizedPnlR.toFixed(2)
                }R`,
              );
            }

            if (trailingStopActive) {
              trailingStopPrice = lowestPrice +
                (config.trailing_stop.trail_distance_R * riskPerShare);
              if (trailingStopPrice < updatedStopLoss) {
                updatedStopLoss = trailingStopPrice;
                console.log(
                  `    ↘️  Trailing SL updated to $${
                    updatedStopLoss.toFixed(2)
                  }`,
                );
              }
            }
          }
        }

        // Check for exit conditions using bars
        let exitReason: string | null = null;
        let exitPrice = currentPrice;
        const exitTimestamp = now.toISOString(); // Always use current time for exit

        if (barsData?.bars && barsData.bars.length > 0) {
          // Ignore any bars that occurred before this position was opened.
          const entryTimeMs = Date.parse(pos.entry_timestamp);
          const filteredBars = Number.isFinite(entryTimeMs)
            ? barsData.bars.filter((bar) => {
              const barTime = Date.parse(bar.timestamp);
              return Number.isFinite(barTime) &&
                barTime >= entryTimeMs - 60_000;
            })
            : barsData.bars;

          // Check last few bars for intrabar TP/SL hits
          const recentBars =
            (filteredBars.length > 0 ? filteredBars : barsData.bars).slice(-5);

          for (const bar of recentBars) {
            if (isLong) {
              // LONG: check if bar low hit SL or bar high hit TP
              if (bar.low <= updatedStopLoss && !exitReason) {
                exitReason = "SL_HIT";
                exitPrice = updatedStopLoss;
                console.log(
                  `    🔴 SL hit at $${
                    exitPrice.toFixed(2)
                  } (detected in bar: ${bar.timestamp})`,
                );
                break;
              }
              if (bar.high >= pos.take_profit && !exitReason) {
                exitReason = "TP_HIT";
                exitPrice = pos.take_profit;
                console.log(
                  `    🟢 TP hit at $${
                    exitPrice.toFixed(2)
                  } (bar timestamp: ${exitTimestamp})`,
                );
                break;
              }
            } else {
              // SHORT: check if bar high hit SL or bar low hit TP
              if (bar.high >= updatedStopLoss && !exitReason) {
                exitReason = "SL_HIT";
                exitPrice = updatedStopLoss;
                console.log(
                  `    🔴 SL hit at $${
                    exitPrice.toFixed(2)
                  } (detected in bar: ${bar.timestamp})`,
                );
                break;
              }
              if (bar.low <= pos.take_profit && !exitReason) {
                exitReason = "TP_HIT";
                exitPrice = pos.take_profit;
                console.log(
                  `    🟢 TP hit at $${
                    exitPrice.toFixed(2)
                  } (bar timestamp: ${exitTimestamp})`,
                );
                break;
              }
            }
          }

          if (
            !exitReason && filteredBars.length === 0 &&
            Number.isFinite(entryTimeMs)
          ) {
            console.warn(
              `    ⚠️ ${pos.ticker}: Only stale bars available (all < entry time), skipping intrabar check`,
            );
          }
        } else {
          // No bars available, check current price only
          if (isLong) {
            if (currentPrice <= updatedStopLoss) {
              exitReason = "SL_HIT";
              exitPrice = updatedStopLoss;
              console.log(`    🔴 SL hit at $${exitPrice.toFixed(2)}`);
            } else if (currentPrice >= pos.take_profit) {
              exitReason = "TP_HIT";
              exitPrice = pos.take_profit;
              console.log(`    🟢 TP hit at $${exitPrice.toFixed(2)}`);
            }
          } else {
            if (currentPrice >= updatedStopLoss) {
              exitReason = "SL_HIT";
              exitPrice = updatedStopLoss;
              console.log(`    🔴 SL hit at $${exitPrice.toFixed(2)}`);
            } else if (currentPrice <= pos.take_profit) {
              exitReason = "TP_HIT";
              exitPrice = pos.take_profit;
              console.log(`    🟢 TP hit at $${exitPrice.toFixed(2)}`);
            }
          }
        }

        // Execute exit or update position
        if (exitReason) {
          totalExits++;
          const exitPriceDiff = isLong
            ? exitPrice - pos.entry_price
            : pos.entry_price - exitPrice;
          const realizedPnl = exitPriceDiff * pos.size_shares;
          const realizedPnlR = realizedPnl / pos.risk_dollars;

          // Record closed trade
          await supabase.from("live_trades").insert({
            strategy: pos.strategy,
            ticker: pos.ticker,
            side: pos.side,
            signal_id: pos.signal_id,
            engine_version: pos.engine_version,
            entry_timestamp: pos.entry_timestamp,
            entry_price: pos.entry_price,
            size_shares: pos.size_shares,
            notional_at_entry: pos.notional_at_entry,
            exit_timestamp: exitTimestamp,
            exit_price: exitPrice,
            exit_reason: exitReason,
            stop_loss: pos.stop_loss,
            take_profit: pos.take_profit,
            risk_dollars: pos.risk_dollars,
            risk_r: pos.risk_r,
            realized_pnl_dollars: realizedPnl,
            realized_pnl_r: realizedPnlR,
          });

          // Delete from open positions
          await supabase.from("live_positions").delete().eq("id", pos.id);

          console.log(
            `    ✅ Position closed: ${exitReason} | P&L: ${
              realizedPnlR.toFixed(2)
            }R ($${realizedPnl.toFixed(2)})`,
          );
        } else {
          // Update position with current data
          await supabase
            .from("live_positions")
            .update({
              current_price: currentPrice,
              unrealized_pnl_dollars: unrealizedPnl,
              unrealized_pnl_r: unrealizedPnlR,
              stop_loss: updatedStopLoss,
              trailing_stop_active: trailingStopActive,
              highest_price_reached: highestPrice,
              lowest_price_reached: lowestPrice,
              trailing_stop_price: trailingStopPrice,
              last_updated: now.toISOString(),
            })
            .eq("id", pos.id);
        }
      }
    }

    console.log(
      `\n✅ Live Position Monitor Complete: ${totalMonitored} monitored, ${totalExits} closed`,
    );

    return new Response(
      JSON.stringify({
        success: true,
        monitored: totalMonitored,
        closed: totalExits,
        timestamp: now.toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("❌ Live Position Monitor error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

async function loadRealtimeQuotesMap(
  supabase: ReturnType<typeof createClient>,
  tickers: string[],
  maxAgeMs = 60_000,
): Promise<Map<string, { price: number; updatedAt: number }>> {
  if (!tickers.length) return new Map();

  const { data, error } = await supabase
    .from("realtime_market_data")
    .select(
      "symbol, bid_price, ask_price, last_trade_price, mid_price, updated_at",
    )
    .in("symbol", tickers);

  if (error || !data) {
    console.warn(
      "[live_position_monitor] Failed to load realtime quotes, will fallback to Yahoo",
      error,
    );
    return new Map();
  }

  const map = new Map<string, { price: number; updatedAt: number }>();
  for (const row of data) {
    const updatedAtMs = row.updated_at ? Date.parse(row.updated_at) : NaN;
    if (!Number.isFinite(updatedAtMs) || Date.now() - updatedAtMs > maxAgeMs) {
      continue;
    }

    const price = pickRealtimePrice(row);
    if (price == null) continue;
    map.set(row.symbol, { price, updatedAt: updatedAtMs });
  }

  return map;
}

function pickRealtimePrice(row: {
  bid_price: number | null;
  ask_price: number | null;
  mid_price: number | null;
  last_trade_price: number | null;
}): number | null {
  if (row.mid_price != null) return row.mid_price;
  if (row.bid_price != null && row.ask_price != null) {
    return Number(((row.bid_price + row.ask_price) / 2).toFixed(4));
  }
  if (row.last_trade_price != null) return row.last_trade_price;
  if (row.bid_price != null) return row.bid_price;
  if (row.ask_price != null) return row.ask_price;
  return null;
}
