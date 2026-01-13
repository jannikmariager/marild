"use client";

import { useState, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, TrendingUp, Target, Zap, HelpCircle } from "lucide-react";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { BACKTEST_VERSION } from "@/lib/backtest/version";
import { useBacktestResults } from "@/lib/hooks/useBacktestResults";
import type { BacktestResult } from "@/lib/backtest/types_results";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

interface BacktestV46ViewerProps {
  symbol: string;
}

type HorizonKey = "day" | "swing" | "invest";

interface HorizonConfig {
  key: HorizonKey;
  title: string;
  description: string;
  icon: typeof Zap;
}

const HORIZONS: HorizonConfig[] = [
  { 
    key: "day", 
    title: "Day", 
    description: "90-day intraday model",
    icon: Zap
  },
  { 
    key: "swing", 
    title: "Swing", 
    description: "2-year swing model",
    icon: TrendingUp
  },
  { 
    key: "invest", 
    title: "Invest", 
    description: "5-year investor model",
    icon: Target
  },
];

function formatPercent(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "0.0%";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}

function formatNumber(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "0";
  return v.toLocaleString();
}

function formatR(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "0.00R";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(2)}R`;
}

function formatDate(timestamp: string | number): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(timestamp);
  }
}

function formatPrice(price: number | null | undefined): string {
  if (price == null || !Number.isFinite(price)) return "$0.00";
  return `$${price.toFixed(2)}`;
}

type ChartTooltipProps = {
  active?: boolean;
  payload?: Array<{
    value?: number;
    payload?: { date?: string };
  }>;
};

function BacktestV46Tooltip({ active, payload }: ChartTooltipProps) {
  if (active && payload && payload.length) {
    const point = payload[0];
    const value = typeof point?.value === "number" ? point.value : null;
    const date = (point?.payload as { date?: string })?.date;
    if (value != null) {
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          {date && <p className="text-xs text-gray-600 mb-1">{date}</p>}
          <p className="text-sm font-semibold text-gray-900">
            ${value.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
          </p>
        </div>
      );
    }
  }
  return null;
}

export function BacktestV46Viewer({ symbol }: BacktestV46ViewerProps) {
  const [selectedHorizon, setSelectedHorizon] = useState<HorizonKey>("swing");
  const { data, isLoading, isError } = useBacktestResults(symbol);

  const result: BacktestResult | null = useMemo(() => {
    if (!data) return null;
    return data[selectedHorizon] ?? null;
  }, [data, selectedHorizon]);

  // Calculate equity curve data for chart
  const equityChartData = useMemo(() => {
    if (!result?.stats || !Array.isArray(result.stats.equity_curve)) return [];
    
    return (result.stats.equity_curve as any[]).map((point) => ({
      timestamp: point.t,
      balance: point.balance,
      date: formatDate(point.t),
    }));
  }, [result]);

  // Calculate metrics
  const metrics = useMemo(() => {
    if (!result?.stats) return null;

    const equityCurve = (result.stats as any).equity_curve || [];
    const initialBalance = equityCurve[0]?.balance ?? 100000;
    const finalBalance = equityCurve[equityCurve.length - 1]?.balance ?? initialBalance;
    const totalReturnPct = ((finalBalance - initialBalance) / initialBalance) * 100;

    // Calculate CAGR (approximate based on timeframe)
    const yearsMap: Record<HorizonKey, number> = { day: 90/365, swing: 2, invest: 5 };
    const years = yearsMap[selectedHorizon];
    const cagr = years > 0 ? (Math.pow(finalBalance / initialBalance, 1 / years) - 1) * 100 : 0;

    const bestTrade = result.stats.best_trade_r ?? null;
    const worstTrade = result.stats.worst_trade_r ?? null;

    return {
      totalReturn: totalReturnPct,
      cagr,
      winRate: result.stats.win_rate,
      maxDrawdown: result.stats.max_drawdown,
      tradesTotal: result.stats.trades_total,
      avgR: result.stats.avg_r,
      bestTrade,
      worstTrade,
    };
  }, [result, selectedHorizon]);


  return (
    <Card className="border-gray-200">
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BarChart3 className="h-5 w-5 text-indigo-500" />
              AI Backtest Results (V{BACKTEST_VERSION})
            </CardTitle>
            <CardDescription className="mt-1 text-sm">
              90-day intraday • 2-year swing • 5-year investor
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <p className="text-sm text-muted-foreground">Loading backtest results…</p>
        )}

        {isError && !isLoading && (
          <p className="text-sm text-red-500">Unable to load backtest results right now.</p>
        )}

        {!isLoading && !isError && !data && (
          <p className="text-sm text-muted-foreground">
            Backtest results are coming soon for this ticker.
          </p>
        )}

        {!isLoading && !isError && data && (
          <div className="space-y-6">
            {/* Horizon Selector */}
            <div className="flex gap-2">
              {HORIZONS.map((horizon) => {
                const Icon = horizon.icon;
                const isSelected = selectedHorizon === horizon.key;
                const hasData = !!data[horizon.key];
                
                return (
                  <Button
                    key={horizon.key}
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                    onClick={() => setSelectedHorizon(horizon.key)}
                    disabled={!hasData}
                    className="flex items-center gap-2"
                  >
                    <Icon className="h-4 w-4" />
                    {horizon.title}
                  </Button>
                );
              })}
            </div>

            {!result && (
              <p className="text-sm text-muted-foreground">
                No backtest data available for this horizon.
              </p>
            )}

            {result && metrics && (
              <>
                {/* Metrics Summary */}
                <TooltipProvider>
                  <div className="rounded-lg border bg-slate-50/40 p-4">
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Metrics Summary</h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                      <div>
                        <div className="text-gray-500 text-xs flex items-center gap-1">
                          Total Return
                          <UITooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3 w-3 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs max-w-xs">Overall percentage gain or loss on the $100k starting capital after all trades</p>
                            </TooltipContent>
                          </UITooltip>
                        </div>
                        <div className={`font-semibold text-lg ${metrics.totalReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatPercent(metrics.totalReturn)}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500 text-xs flex items-center gap-1">
                          CAGR
                          <UITooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3 w-3 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs max-w-xs">Compound Annual Growth Rate - the annualized return if compounded over time</p>
                            </TooltipContent>
                          </UITooltip>
                        </div>
                        <div className="font-semibold text-lg text-gray-900">
                          {formatPercent(metrics.cagr)}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500 text-xs flex items-center gap-1">
                          Win Rate
                          <UITooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3 w-3 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs max-w-xs">Percentage of trades that were profitable (closed in profit)</p>
                            </TooltipContent>
                          </UITooltip>
                        </div>
                        <div className="font-semibold text-lg text-gray-900">
                          {formatPercent(metrics.winRate)}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500 text-xs flex items-center gap-1">
                          Max Drawdown
                          <UITooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3 w-3 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs max-w-xs">Largest peak-to-trough decline in portfolio value - shows worst-case loss from a high point</p>
                            </TooltipContent>
                          </UITooltip>
                        </div>
                        <div className="font-semibold text-lg text-red-600">
                          {formatPercent(metrics.maxDrawdown)}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500 text-xs flex items-center gap-1">
                          Best Trade
                          <UITooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3 w-3 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs max-w-xs">Best single trade in R-multiples (R = initial risk/stop loss distance). +2R means profit was 2x the risk</p>
                            </TooltipContent>
                          </UITooltip>
                        </div>
                        <div className="font-semibold text-lg text-green-600">
                          {formatR(metrics.bestTrade)}
                        </div>
                      </div>
                      <div>
                        <div className="text-gray-500 text-xs flex items-center gap-1">
                          Worst Trade
                          <UITooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3 w-3 cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs max-w-xs">Worst single trade in R-multiples. -1R means loss equaled the initial risk (stop loss hit)</p>
                            </TooltipContent>
                          </UITooltip>
                        </div>
                        <div className="font-semibold text-lg text-red-600">
                          {formatR(metrics.worstTrade)}
                        </div>
                      </div>
                    </div>
                  </div>
                </TooltipProvider>

                {/* Equity Curve Chart */}
                {equityChartData.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      📈 Equity Curve
                    </h3>
                    <div className="rounded-lg border bg-white p-4">
                      <ResponsiveContainer width="100%" height={280}>
                        <LineChart data={equityChartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis 
                            dataKey="date" 
                            stroke="#6b7280"
                            fontSize={11}
                            tickLine={false}
                            interval="preserveStartEnd"
                          />
                          <YAxis 
                            stroke="#6b7280"
                            fontSize={11}
                            tickLine={false}
                            tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
                          />
                          <Tooltip content={<BacktestV46Tooltip />} />
                          <Line 
                            type="monotone" 
                            dataKey="balance" 
                            stroke="#10b981"
                            strokeWidth={2}
                            dot={false}
                            activeDot={{ r: 4 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Trades Table */}
                {Array.isArray(result.trades) && result.trades.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                      📋 Trades Table
                    </h3>
                    <div className="rounded-lg border bg-white overflow-hidden">
                      <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-slate-50 sticky top-0">
                            <tr className="border-b">
                              <th className="text-left py-2 px-3 font-semibold text-gray-700">Date</th>
                              <th className="text-left py-2 px-3 font-semibold text-gray-700">Direction</th>
                              <th className="text-right py-2 px-3 font-semibold text-gray-700">Entry</th>
                              <th className="text-right py-2 px-3 font-semibold text-gray-700">Exit</th>
                              <th className="text-right py-2 px-3 font-semibold text-gray-700">P/L R</th>
                              <th className="text-right py-2 px-3 font-semibold text-gray-700">P/L %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.trades.map((trade: any, idx: number) => {
                              const pnlR = trade.r_multiple ?? trade.pnl_r ?? 0;
                              const pnlPct = trade.pnl_pct ?? ((trade.exit_price - trade.entry_price) / trade.entry_price * 100);
                              const isProfit = pnlR >= 0;
                              
                              return (
                                <tr key={idx} className="border-b hover:bg-slate-50">
                                  <td className="py-2 px-3 text-gray-600">
                                    {formatDate(trade.entry_time ?? trade.entryTime ?? '')}
                                  </td>
                                  <td className="py-2 px-3">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                      trade.direction === 'long' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                    }`}>
                                      {trade.direction?.toUpperCase() ?? 'LONG'}
                                    </span>
                                  </td>
                                  <td className="py-2 px-3 text-right text-gray-900">
                                    {formatPrice(trade.entry_price ?? trade.entryPrice)}
                                  </td>
                                  <td className="py-2 px-3 text-right text-gray-900">
                                    {formatPrice(trade.exit_price ?? trade.exitPrice)}
                                  </td>
                                  <td className={`py-2 px-3 text-right font-semibold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                                    {formatR(pnlR)}
                                  </td>
                                  <td className={`py-2 px-3 text-right font-semibold ${isProfit ? 'text-green-600' : 'text-red-600'}`}>
                                    {formatPercent(pnlPct)}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
