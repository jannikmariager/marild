// @ts-nocheck
// Admin Engine Metrics Alert
// Posts an hourly snapshot of engine performance (matching admin Engine Metrics page)
// to the admin-alerts Discord channel.
//
// To schedule hourly, create a Supabase Edge Function schedule pointing to this
// function (e.g. cron: "0 * * * *").

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// ---- Discord helper ----

interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: string;
}

async function sendAdminAlertsEmbed(embeds: DiscordEmbed[]) {
  const channelId = Deno.env.get("DISCORD_ADMIN_ALERTS_CHANNEL_ID");
  if (!channelId) {
    console.warn("[admin_engine_metrics_alert] DISCORD_ADMIN_ALERTS_CHANNEL_ID not configured; skipping Discord post");
    return;
  }
  const webhookUrl = `https://discord.com/api/webhooks/${channelId}`;
  const resp = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds }),
  });
  if (!resp.ok) {
    console.error("[admin_engine_metrics_alert] Discord webhook failed", resp.status, await resp.text());
  }
}

// ---- Engine metrics computation (mirrors app/api/admin/engine-metrics/route.ts) ----

const STARTING_EQUITY = 100000;

const LABEL_OVERRIDES: Record<string, string> = {
  SWING_V1_EXPANSION: "Baseline (Swing Expansion)",
  SWING_FAV8_SHADOW: "SWING_FAV8_SHADOW",
  SWING_V2_ROBUST: "SWING_V2_ROBUST",
  SWING_V1_12_15DEC: "SWING_V1_12_15DEC",
  SCALP_V1_MICROEDGE: "SCALP_V1_MICROEDGE",
  QUICK_PROFIT_V1: "Quick profit shadow engine",
  SWING_SHADOW_CTX_V1: "SWING Context Shadow V1",
  v1: "Crypto V1", // crypto shadow uses engine_version = 'v1'
};

const RETIRED_SHADOW_VERSIONS = new Set(["SWING_V1_12_15DEC", "SWING_FAV8_SHADOW"]);

const ENGINE_SOURCE_ALIASES: Record<string, { engine_key: string; engine_version: string }> = {
  QUICK_PROFIT_V1: { engine_key: "SCALP", engine_version: "SCALP_V1_MICROEDGE" },
};

type EngineSource = { engine_key: string; engine_version: string };

const ENGINE_SOURCE_MAP: Record<string, EngineSource[]> = {
  QUICK_PROFIT_V1: [
    { engine_key: "QUICK_PROFIT", engine_version: "QUICK_PROFIT_V1" },
    { engine_key: "SCALP", engine_version: "SCALP_V1_MICROEDGE" },
  ],
};

function getEngineSources(versionKey: string, engineKey: string, engineVersion: string): EngineSource[] {
  const key = (versionKey || "").toUpperCase();
  return ENGINE_SOURCE_MAP[key] ?? [{ engine_key: engineKey, engine_version: engineVersion }];
}

type StockShadowData = {
  engine_key: string;
  engine_version: string;
  tradeData: any[];
  portfolioData: any[];
  openCount: number;
  overrideStartingEquity: number | null;
  overrideCurrentEquity: number | null;
};

function directionMultiplier(side: "LONG" | "SHORT" | null | undefined) {
  return side === "SHORT" ? -1 : 1;
}

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchStockShadowData(
  supabase: SupabaseClient,
  params: { engine_key: string; engine_version: string; run_mode: string },
): Promise<StockShadowData> {
  const { engine_key, engine_version, run_mode } = params;

  const { data: trades, error: tradesError } = await supabase
    .from("engine_trades")
    .select("ticker, side, entry_price, exit_price, realized_pnl, realized_r, closed_at, opened_at")
    .eq("engine_key", engine_key)
    .eq("engine_version", engine_version)
    .eq("run_mode", run_mode)
    .order("closed_at", { ascending: false });

  if (tradesError) throw tradesError;

  const tradeData = (trades || []).map((t: any) => ({
    ticker: t.ticker,
    side: t.side,
    entry_price: t.entry_price,
    exit_price: t.exit_price,
    realized_pnl_dollars: t.realized_pnl,
    realized_pnl_r: t.realized_r,
    exit_timestamp: t.closed_at,
    entry_timestamp: t.opened_at,
  }));

  const { data: portfolio, error: portfolioError } = await supabase
    .from("engine_portfolios")
    .select("equity, starting_equity, updated_at")
    .eq("engine_key", engine_key)
    .eq("engine_version", engine_version)
    .eq("run_mode", run_mode)
    .maybeSingle();

  if (portfolioError) throw portfolioError;

  let overrideStartingEquity: number | null = null;
  let overrideCurrentEquity: number | null = null;

  type PortfolioRow = {
    equity: number | null;
    starting_equity: number | null;
    updated_at: string;
  };

  const portfolioRow = portfolio as PortfolioRow | null;

  const portfolioData = portfolioRow
    ? [
        {
          equity_dollars: Number(portfolioRow.equity ?? 0),
          timestamp: portfolioRow.updated_at,
        },
      ]
    : [];

  if (portfolioRow) {
    overrideStartingEquity = Number(portfolioRow.starting_equity ?? 100000);
    overrideCurrentEquity = Number(portfolioRow.equity ?? overrideStartingEquity);
  }

  const { data: openPositions, error: openError } = await supabase
    .from("engine_positions")
    .select("id")
    .eq("engine_key", engine_key)
    .eq("engine_version", engine_version)
    .eq("run_mode", run_mode)
    .eq("status", "OPEN");

  if (openError) throw openError;

  return {
    engine_key,
    engine_version,
    tradeData,
    portfolioData,
    openCount: openPositions?.length ?? 0,
    overrideStartingEquity,
    overrideCurrentEquity,
  };
}

const isToday = (timestamp?: string | null, dayString?: string) => {
  if (!timestamp) return false;
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return false;
  const compareDate = dayString ?? new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10) === compareDate;
};

interface EngineMetric {
  engine_version: string;
  engine_key: string;
  run_mode: "PRIMARY" | "SHADOW" | string;
  is_enabled: boolean;
  is_user_visible?: boolean | null;
  total_trades: number;
  winners: number;
  losers: number;
  win_rate: number;
  total_pnl: number;
  todays_pnl: number;
  todays_live_pnl: number;
  unrealized_pnl: number;
  avg_r: number;
  max_drawdown: number;
  current_equity: number;
  net_return: number;
  display_label: string;
}

async function computeEngineMetrics(supabase: SupabaseClient): Promise<EngineMetric[]> {
  const requestDate = new Date().toISOString().slice(0, 10);

  const { data: engineVersions, error: versionsError } = await supabase
    .from("engine_versions")
    .select("*, settings")
    .order("created_at", { ascending: false });

  if (versionsError) {
    console.error("[admin_engine_metrics_alert] Error fetching engine_versions:", versionsError);
    throw versionsError;
  }

  const metrics: EngineMetric[] = [];

  for (const version of engineVersions || []) {
    const versionKey = (version.engine_version || "").toUpperCase();
    if (versionKey === "SCALP_V1_MICROEDGE") {
      // Legacy SCALP entry is superseded by the Quick profit alias
      continue;
    }
    if (RETIRED_SHADOW_VERSIONS.has(versionKey)) {
      continue;
    }

    const alias = ENGINE_SOURCE_ALIASES[versionKey];
    let sourceEngineKey = alias?.engine_key ?? version.engine_key;
    let sourceEngineVersion = alias?.engine_version ?? version.engine_version;
    const isPrimary = version.run_mode === "PRIMARY";
    const isCrypto =
      (version.asset_class ?? "").toLowerCase() === "crypto" || version.engine_key === "CRYPTO_V1_SHADOW";

    let tradeData: any[] = [];
    let portfolioData: any[] = [];

    let unrealizedPnl = 0;
    let overrideStartingEquity: number | null = null;
    let overrideCurrentEquity: number | null = null;

    if (isPrimary) {
      // PRIMARY: LIVE SWING engine only — same source of truth as webapp summary
      const { data: trades, error: tradesError } = await supabase
        .from("live_trades")
        .select(
          "ticker, side, entry_timestamp, entry_price, exit_timestamp, exit_price, realized_pnl_dollars, realized_pnl_r",
        )
        .eq("strategy", "SWING")
        .eq("engine_key", "SWING")
        .order("exit_timestamp", { ascending: false });

      if (tradesError) {
        console.error(`[admin_engine_metrics_alert] Error fetching live_trades for ${version.engine_version}:`, tradesError);
        continue;
      }

      tradeData = (trades || []).map((trade) => ({
        ticker: trade.ticker,
        side: trade.side,
        entry_timestamp: trade.entry_timestamp,
        entry_price: trade.entry_price,
        exit_timestamp: trade.exit_timestamp,
        exit_price: trade.exit_price,
        realized_pnl_dollars: trade.realized_pnl_dollars,
        realized_pnl_r: trade.realized_pnl_r,
      }));

      // Get historical portfolio snapshots for equity curve only (UI chart)
      const { data: portfolio, error: portfolioError } = await supabase
        .from("live_portfolio_state")
        .select("equity_dollars, timestamp")
        .eq("strategy", "SWING")
        .order("timestamp", { ascending: false })
        .limit(1000);

      if (portfolioError) {
        console.error("[admin_engine_metrics_alert] Error fetching live_portfolio_state:", portfolioError);
        portfolioData = [];
      } else {
        portfolioData = (portfolio || []).reverse();
      }
    } else {
      // SHADOW: get data from engine_* tables (stocks) or engine_crypto_* (crypto)
      if (isCrypto) {
        const { data: trades, error: tradesError } = await supabase
          .from("engine_crypto_trades")
          .select("symbol, side, price, qty, pnl, executed_at, action")
          .eq("engine_key", sourceEngineKey)
          .eq("version", sourceEngineVersion)
          .order("executed_at", { ascending: false });

        if (tradesError) {
          console.error(
            `[admin_engine_metrics_alert] Error fetching engine_crypto_trades for ${version.engine_version}:`,
            tradesError,
          );
          continue;
        }

        tradeData = (trades || []).map((t: any) => ({
          ticker: t.symbol,
          side: t.side === "sell" ? "SHORT" : "LONG",
          entry_price: t.price,
          exit_price: t.price,
          realized_pnl_dollars: t.pnl,
          realized_pnl_r: null,
          exit_timestamp: t.executed_at,
          entry_timestamp: t.executed_at,
        }));

        const { data: portfolio, error: portfolioError } = await supabase
          .from("engine_crypto_portfolio_state")
          .select("equity, unrealized, realized, ts")
          .eq("engine_key", sourceEngineKey)
          .eq("version", sourceEngineVersion)
          .order("ts", { ascending: true })
          .limit(1000);

        if (portfolioError) {
          console.error(
            `[admin_engine_metrics_alert] Error fetching engine_crypto_portfolio_state for ${version.engine_version}:`,
            portfolioError,
          );
          continue;
        }

        portfolioData = (portfolio || []).map((p: any) => ({
          equity_dollars: p.equity,
          timestamp: p.ts,
          unrealized: p.unrealized ?? 0,
          realized: p.realized ?? 0,
        }));

        const { data: openPositions, error: openError } = await supabase
          .from("engine_crypto_positions")
          .select("unrealized_pnl")
          .eq("engine_key", sourceEngineKey)
          .eq("version", sourceEngineVersion)
          .eq("status", "open");

        if (!openError && openPositions) {
          unrealizedPnl = openPositions.reduce((sum, pos) => sum + Number(pos.unrealized_pnl ?? 0), 0);
        }
      } else {
        const versionKeyUpper = (version.engine_version || "").toUpperCase();
        const candidateSources = getEngineSources(versionKeyUpper, version.engine_key, version.engine_version);
        let stockResult: StockShadowData | null = null;

        for (const candidate of candidateSources) {
          try {
            const result = await fetchStockShadowData(supabase, {
              engine_key: candidate.engine_key,
              engine_version: candidate.engine_version,
              run_mode: version.run_mode,
            });
            stockResult = result;
            const hasData =
              result.tradeData.length > 0 ||
              result.openCount > 0 ||
              (result.overrideStartingEquity != null &&
                result.overrideCurrentEquity != null &&
                Math.abs(result.overrideCurrentEquity - result.overrideStartingEquity) > 1e-6);
            if (hasData) {
              break;
            }
          } catch (err) {
            console.error(
              `[admin_engine_metrics_alert] Error fetching shadow data for ${candidate.engine_key}/${candidate.engine_version}:`,
              err,
            );
            continue;
          }
        }

        if (!stockResult) {
          continue;
        }

        sourceEngineKey = stockResult.engine_key;
        sourceEngineVersion = stockResult.engine_version;
        tradeData = stockResult.tradeData;
        portfolioData = stockResult.portfolioData;
        overrideStartingEquity = stockResult.overrideStartingEquity;
        overrideCurrentEquity = stockResult.overrideCurrentEquity;

        if (versionKeyUpper === "QUICK_PROFIT_V1") {
          const { data: qpClosed, error: qpClosedError } = await supabase
            .from("engine_positions")
            .select(
              "ticker, side, entry_price, exit_price, realized_pnl, realized_r, opened_at, closed_at, status",
            )
            .eq("engine_key", sourceEngineKey)
            .eq("engine_version", sourceEngineVersion)
            .eq("run_mode", version.run_mode)
            .eq("status", "CLOSED");

          if (qpClosedError) {
            console.error(
              "[admin_engine_metrics_alert] Error fetching Quick Profit CLOSED positions for engine-metrics:",
              qpClosedError,
            );
          } else if (qpClosed && qpClosed.length > 0) {
            tradeData = (qpClosed as any[]).map((p) => ({
              ticker: p.ticker,
              side: p.side,
              entry_price: p.entry_price,
              exit_price: p.exit_price,
              realized_pnl_dollars: p.realized_pnl,
              realized_pnl_r: p.realized_r,
              exit_timestamp: p.closed_at,
              entry_timestamp: p.opened_at,
            }));
          }

          try {
            const { data: qpOpen, error: qpOpenError } = await supabase
              .from("engine_positions")
              .select("ticker, side, qty, entry_price, management_meta")
              .eq("engine_key", sourceEngineKey)
              .eq("engine_version", sourceEngineVersion)
              .eq("run_mode", version.run_mode)
              .eq("status", "OPEN");

            if (qpOpenError) {
              console.error(
                "[admin_engine_metrics_alert] Error fetching Quick Profit OPEN positions for engine-metrics:",
                qpOpenError,
              );
            } else if (qpOpen && qpOpen.length > 0) {
              const positions = qpOpen as Array<{
                ticker: string | null;
                side: "LONG" | "SHORT" | null;
                qty: number | string | null;
                entry_price: number | string | null;
                management_meta: Record<string, unknown> | null;
              }>;

              const tickers = Array.from(
                new Set(
                  positions
                    .map((pos) => (pos.ticker || "").trim().toUpperCase())
                    .filter((ticker) => ticker.length > 0),
                ),
              );

              let latestCloses: Record<string, number> = {};
              if (tickers.length > 0) {
                const { data: barRows, error: barsError } = await supabase
                  .from("bars_1m")
                  .select("symbol, ts, close")
                  .in("symbol", tickers)
                  .order("ts", { ascending: false })
                  .limit(tickers.length * 50);

                if (barsError) {
                  console.error(
                    "[admin_engine_metrics_alert] Failed to load bars_1m for Quick Profit marks",
                    barsError.message ?? barsError,
                  );
                } else if (barRows) {
                  latestCloses = {};
                  for (const row of barRows as Array<{ symbol: string; ts: string; close: number }>) {
                    const symbol = (row.symbol || "").toUpperCase();
                    if (!symbol) continue;
                    if (latestCloses[symbol] !== undefined) continue;
                    const val = Number(row.close);
                    if (!Number.isFinite(val)) continue;
                    latestCloses[symbol] = val;
                  }
                }
              }

              let qpUnrealized = 0;
              for (const pos of positions) {
                const ticker = (pos.ticker || "").toUpperCase();
                const entryPriceRaw = toNumber(pos.entry_price);
                const entryPrice = entryPriceRaw ?? 0;
                const qtyRaw = toNumber(pos.qty);
                const qty = qtyRaw ?? 0;
                const markFromBars = ticker ? latestCloses[ticker] : undefined;
                const meta = (pos.management_meta as Record<string, unknown> | null) ?? null;
                let metaMarkPrice: number | null = null;
                if (meta) {
                  const rawMetaPrice =
                    (meta as Record<string, unknown>).last_quote_price ??
                    (meta as Record<string, unknown>).mark_price ??
                    (meta as Record<string, unknown>).last_price ??
                    null;
                  if (typeof rawMetaPrice === "number" || typeof rawMetaPrice === "string") {
                    metaMarkPrice = toNumber(rawMetaPrice);
                  }
                }

                const markPrice =
                  markFromBars !== undefined && Number.isFinite(markFromBars)
                    ? Number(markFromBars)
                    : metaMarkPrice ?? entryPrice;

                const direction = directionMultiplier(pos.side as any);

                if (qtyRaw !== null && entryPriceRaw !== null && markPrice !== null) {
                  const pnlDollars = (markPrice - entryPrice) * qty * direction;
                  if (Number.isFinite(pnlDollars)) {
                    qpUnrealized += Number(pnlDollars);
                  }
                }
              }

              unrealizedPnl = qpUnrealized;
            }
          } catch (err) {
            console.error(
              "[admin_engine_metrics_alert] Error computing Quick Profit unrealized PnL for engine-metrics:",
              err,
            );
          }
        }
      }
    }

    const totalTrades = tradeData.length;
    const winners = tradeData.filter((t: any) => (t.realized_pnl_dollars || 0) > 0).length;
    const losers = tradeData.filter((t: any) => (t.realized_pnl_dollars || 0) < 0).length;
    const winRate = totalTrades > 0 ? (winners / totalTrades) * 100 : 0;

    if (isPrimary) {
      const { data: openPositions, error: openPositionsError } = await supabase
        .from("live_positions")
        .select("unrealized_pnl_dollars")
        .eq("strategy", "SWING")
        .eq("engine_key", "SWING");

      if (openPositionsError) {
        console.error(
          `[admin_engine_metrics_alert] Error fetching live_positions for ${version.engine_version}:`,
          openPositionsError,
        );
      } else {
        unrealizedPnl = (openPositions || []).reduce(
          (sum, pos) => sum + Number(pos.unrealized_pnl_dollars ?? 0),
          0,
        );
      }
    }

    const totalRealized = tradeData.reduce((sum: number, t: any) => sum + (t.realized_pnl_dollars || 0), 0);
    if (!isPrimary && overrideStartingEquity != null && overrideCurrentEquity != null && versionKey !== "QUICK_PROFIT_V1") {
      unrealizedPnl = overrideCurrentEquity - overrideStartingEquity - totalRealized;
    }
    const todaysRealized = tradeData.reduce(
      (sum: number, t: any) => (isToday(t.exit_timestamp, requestDate) ? sum + (t.realized_pnl_dollars || 0) : sum),
      0,
    );
    const todaysLivePnl = todaysRealized + unrealizedPnl;
    const totalPnl = totalRealized + unrealizedPnl;
    const avgR =
      tradeData.length > 0
        ? tradeData.reduce((sum: number, t: any) => sum + (t.realized_pnl_r || 0), 0) / tradeData.length
        : 0;

    let maxDrawdown = 0;
    if (portfolioData.length > 0) {
      let peak = portfolioData[0]?.equity_dollars || 100000;
      for (const snapshot of portfolioData) {
        const equity = snapshot.equity_dollars || 0;
        if (equity > peak) {
          peak = equity;
        } else {
          const drawdown = ((peak - equity) / peak) * 100;
          if (drawdown > maxDrawdown) {
            maxDrawdown = drawdown;
          }
        }
      }
    }

    const startingEquity = STARTING_EQUITY;

    let currentEquity = startingEquity;
    if (isPrimary) {
      currentEquity = startingEquity + totalRealized + unrealizedPnl;
    } else {
      if (portfolioData.length > 0) {
        const mostRecent = portfolioData[portfolioData.length - 1] as any;
        currentEquity = mostRecent?.equity_dollars || mostRecent?.equity || startingEquity;
      }
    }

    const netReturn = ((currentEquity - startingEquity) / startingEquity) * 100;

    const display_label =
      LABEL_OVERRIDES[version.engine_version] ??
      (isCrypto ? LABEL_OVERRIDES["v1"] : undefined) ??
      version.notes ??
      version.engine_version;

    metrics.push({
      engine_version: version.engine_version,
      engine_key: version.engine_key,
      run_mode: version.run_mode,
      is_enabled: version.is_enabled,
      is_user_visible: version.is_user_visible,
      total_trades: totalTrades,
      winners,
      losers,
      win_rate: winRate,
      total_pnl: totalPnl,
      todays_pnl: todaysRealized,
      todays_live_pnl: todaysLivePnl,
      unrealized_pnl: unrealizedPnl,
      avg_r: avgR,
      max_drawdown: maxDrawdown,
      current_equity: currentEquity,
      net_return: netReturn,
      display_label,
    });
  }

  return metrics;
}

// ---- Handler ----

Deno.serve(async (_req) => {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const metrics = await computeEngineMetrics(supabase as any);

    const primary = metrics.filter((m) => m.run_mode === "PRIMARY");
    const shadow = metrics.filter((m) => m.run_mode === "SHADOW" && !RETIRED_SHADOW_VERSIONS.has((m.engine_version || "").toUpperCase()));

    const now = new Date();
    const timestampLabel = now.toISOString().slice(0, 16).replace("T", " ") + " UTC";

    const primaryLines = primary.map((m) => {
      return `• **${m.display_label}** – Trades: ${m.total_trades} (${m.winners}W/${m.losers}L) | Win rate: ${m.win_rate.toFixed(1)}%\n` +
        `  Today PnL: $${(m.todays_pnl || 0).toFixed(2)} realized / $${(m.todays_live_pnl || 0).toFixed(2)} live | Unrealized: $${(m.unrealized_pnl || 0).toFixed(2)}\n` +
        `  Net return: ${m.net_return.toFixed(2)}% | Max DD: -${m.max_drawdown.toFixed(2)}% | Equity: $${m.current_equity.toFixed(2)}`;
    });

    const shadowLines = shadow.map((m) => {
      return `• **${m.display_label}** – Trades: ${m.total_trades} (${m.winners}W/${m.losers}L) | Win rate: ${m.win_rate.toFixed(1)}%\n` +
        `  Today PnL: $${(m.todays_pnl || 0).toFixed(2)} realized / $${(m.todays_live_pnl || 0).toFixed(2)} live | Unrealized: $${(m.unrealized_pnl || 0).toFixed(2)}\n` +
        `  Net return: ${m.net_return.toFixed(2)}% | Max DD: -${m.max_drawdown.toFixed(2)}% | Equity: $${m.current_equity.toFixed(2)}`;
    });

    const embed: DiscordEmbed = {
      title: `Engine Performance Snapshot (${timestampLabel})`,
      description: "Auto-generated hourly snapshot matching the admin Engine Performance page.",
      color: 0x3498db,
      fields: [
        {
          name: "Live Engines (PRIMARY)",
          value: primaryLines.length > 0 ? primaryLines.join("\n\n") : "No primary engines found.",
          inline: false,
        },
        {
          name: "Shadow Engines (SHADOW)",
          value: shadowLines.length > 0 ? shadowLines.join("\n\n") : "No shadow engines found.",
          inline: false,
        },
      ],
      footer: {
        text: "TradeLens AI – Admin engine snapshot",
      },
      timestamp: now.toISOString(),
    };

    await sendAdminAlertsEmbed([embed]);

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[admin_engine_metrics_alert] Unexpected error:", err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
