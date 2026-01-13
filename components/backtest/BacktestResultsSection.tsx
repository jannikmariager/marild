"use client";

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, BarChart3 } from "lucide-react";
import { BACKTEST_VERSION } from "@/lib/backtest/version";
import { useBacktestResults } from "@/lib/hooks/useBacktestResults";
import type { BacktestResult } from "@/lib/backtest/types_results";
import { V4Badge } from "@/components/backtest/V4Badge";
import { TradesModal } from "@/components/backtest/TradesModal";

interface BacktestResultsSectionProps {
  symbol: string;
}

function formatPct(v: number): string {
  if (!Number.isFinite(v)) return "0.0%";
  return `${v.toFixed(1)}%`;
}

function formatR(v: number): string {
  if (!Number.isFinite(v)) return "0.000";
  return v.toFixed(3);
}

interface ModeConfig {
  key: "day" | "swing" | "invest";
  title: string;
  label: string;
}

const MODES: ModeConfig[] = [
  { key: "day", title: "Daytrader", label: "Daytrader (1m, last 90 days)" },
  { key: "swing", title: "Swing", label: "Swing (4h, last 2 years)" },
  { key: "invest", title: "Investor", label: "Investor (1d, last 5 years)" },
];

export function BacktestResultsSection({ symbol }: BacktestResultsSectionProps) {
  const { data, isLoading, isError } = useBacktestResults(symbol);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTrades, setModalTrades] = useState<any[]>([]);
  const [modalLabel, setModalLabel] = useState<string>("");

  const openModal = (label: string, trades: any[]) => {
    setModalLabel(label);
    setModalTrades(trades || []);
    setModalOpen(true);
  };

  const payload = data;
  const day = payload?.day as BacktestResult | null | undefined;
  const swing = payload?.swing as BacktestResult | null | undefined;
  const invest = payload?.invest as BacktestResult | null | undefined;

  const anyAvailable = !!(day || swing || invest);

  return (
    <>
      <Card className="border-gray-200">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm">
              <BarChart3 className="h-4 w-4 text-indigo-500" />
              AI Backtest Results (V{payload?.version ?? `V${BACKTEST_VERSION}`})
            </CardTitle>
            <CardDescription className="mt-1 text-xs">
              90-day intraday • 2-year swing • 5-year investor profiles using the V4.x engine.
            </CardDescription>
          </div>
          <V4Badge version={BACKTEST_VERSION} />
        </CardHeader>
        <CardContent>
          {isLoading && (
            <p className="text-sm text-muted-foreground">Loading backtest results…</p>
          )}

          {isError && !isLoading && (
            <p className="text-sm text-red-500">Unable to load backtest results right now.</p>
          )}

          {!isLoading && !isError && !anyAvailable && (
            <p className="text-sm text-muted-foreground">
              Backtest results are coming soon for this ticker.
            </p>
          )}

          {!isLoading && !isError && anyAvailable && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {MODES.map((mode) => {
                const result =
                  mode.key === "day" ? day : mode.key === "swing" ? swing : invest;

                if (!result) {
                  return (
                    <div key={mode.key} className="rounded-lg border bg-slate-50/40 p-4 flex flex-col justify-between">
                      <div>
                        <div className="text-xs font-semibold text-gray-700 mb-1">{mode.title}</div>
                        <p className="text-[11px] text-gray-400">No backtest available.</p>
                      </div>
                    </div>
                  );
                }

                const lowData = (result.bars_loaded ?? 0) < 200;
                const hasAnomalies = Array.isArray(result.anomalies) && result.anomalies.length > 0;

                return (
                  <div key={mode.key} className="rounded-lg border p-4 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-semibold text-gray-800">{mode.title}</div>
                        <div className="flex items-center gap-1">
                          <span className="inline-flex items-center rounded-full bg-slate-100 text-[10px] px-2 py-0.5 text-slate-700 border border-slate-200">
                            TF: {result.timeframe_used || "?"}
                          </span>
                          {lowData && (
                            <span className="inline-flex items-center rounded-full bg-amber-50 text-[10px] px-2 py-0.5 text-amber-700 border border-amber-200">
                              Low Data
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-500">{mode.label}</p>

                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-gray-700">
                        <div>
                          <span className="font-medium">Trades:</span>{" "}
                          {result.stats.trades_total}
                        </div>
                        <div>
                          <span className="font-medium">Win rate:</span>{" "}
                          {formatPct(result.stats.win_rate)}
                        </div>
                        <div>
                          <span className="font-medium">Avg R:</span>{" "}
                          {formatR(result.stats.avg_r)}
                        </div>
                        <div>
                          <span className="font-medium">Max DD:</span>{" "}
                          {formatPct(result.stats.max_drawdown)}
                        </div>
                      </div>

                      {hasAnomalies && (
                        <div className="mt-2 flex items-center gap-1 text-[11px] text-amber-700">
                          <AlertTriangle className="h-3 w-3" />
                          <span>Data warnings</span>
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between">
                      <div className="text-[10px] text-gray-400">Bars: {result.bars_loaded}</div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-[11px] h-7 px-2"
                        disabled={!Array.isArray(result.trades) || result.trades.length === 0}
                        onClick={() => openModal(mode.label, result.trades)}
                      >
                        View trades
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <TradesModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        symbol={symbol}
        label={modalLabel}
        trades={modalTrades}
      />
    </>
  );
}
