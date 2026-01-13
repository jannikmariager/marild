"use client";

/**
 * AI Backtest Modal - FINAL APPROVED DESIGN (Dec 2, 2025)
 * 
 * CRITICAL: This component's layout and styling are LOCKED. Do not modify without approval.
 * 
 * Layout specifications:
 * - Modal: max-w-5xl width, 85vh max height, scrollable
 * - Chart: 320px height (h-80), ml-36 left margin for Y-axis labels
 * - Equity curve: Green (#10b981), 1.5px stroke, polyline with vectorEffect="non-scaling-stroke"
 * - Y-axis: $100k baseline, $2,500 increments, left-4 positioning, w-28 width
 * - Grid lines: Blue solid baseline (#3b82f6, 0.3px), gray dashed others (#e5e7eb, 0.15px)
 * - SVG: viewBox="0 0 100 100" preserveAspectRatio="none" for correct scaling
 * 
 * Trade markers (HTML overlays, NOT SVG - to prevent stretching):
 * - Entry (E): Blue circle (#3b82f6), 20px diameter, 6px font, white text, 2px white border
 * - Take Profit (TP): Amber circle (#f59e0b), 20px diameter, 5px font, white text, 2px white border
 * - Stop Loss (SL): Red circle (#dc2626), 20px diameter, 5px font, white text, 2px white border
 * - Positioned using percentage-based absolute positioning with transform: translate(-50%, -50%)
 * 
 * Legend: Centered below chart, matches marker colors exactly
 * 
 * Text colors:
 * - KPI labels: text-foreground/70
 * - Axis labels: text-foreground/80
 * - Y-axis values: text-foreground/70
 * - Disclaimer: text-foreground/90 with font-bold title
 * - Table headers: text-foreground/80 font-semibold
 * 
 * IMPORTANT: Equity curve uses <polyline> NOT <path> or individual <line> elements.
 * This is the only method that renders correctly with preserveAspectRatio="none".
 */

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BacktestStats, EquityCurvePoint, BacktestTrade } from "@/lib/backtest/types";
import { InfoIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface BacktestModalProps {
  open: boolean;
  onClose: () => void;
  symbol: string;
  horizonDays: number;
  stats: BacktestStats;
  equityCurve: EquityCurvePoint[];
  trades: BacktestTrade[];
}

export function BacktestModal({
  open,
  onClose,
  symbol,
  horizonDays,
  stats,
  equityCurve,
  trades,
}: BacktestModalProps) {
  const formatCurrency = (val: number | undefined) => val !== undefined ? `$${val.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '$0';
  const formatPercent = (val: number | undefined) => val !== undefined ? `${val >= 0 ? "+" : ""}${val.toFixed(2)}%` : '0.00%';
  const formatR = (val: number | undefined) => val !== undefined ? `${val >= 0 ? "+" : ""}${val.toFixed(2)}R` : '0.00R';
  
  // Support both field naming conventions with fallbacks
  // New format (from shared_types): totalReturnPct, tradeCount
  // Legacy format (from types): totalReturn, profitPct, totalTrades, tradesCount
  const totalReturn = (stats as any).totalReturnPct ?? stats.totalReturn ?? stats.profitPct ?? 0;
  const winRate = (stats as any).winRatePct ?? stats.winRate ?? (stats as any).winRatePct ?? 0;
  const maxDrawdown = (stats as any).maxDrawdownPct ?? stats.maxDrawdown ?? (stats as any).maxDrawdownPct ?? 0;
  const totalTrades = (stats as any).tradeCount ?? stats.totalTrades ?? stats.tradesCount ?? 0;
  
  // Normalize equity curve to support both formats
  // New format: { time: number, value: number }
  // Legacy format: { t: string, equity: number }
  const normalizedEquityCurve = equityCurve.map(p => ({
    time: (p as any).time ?? new Date((p as any).t).getTime(),
    value: (p as any).value ?? p.equity
  }));
  
  // Calculate Y-axis scale with $100k baseline and $2,500 increments
  const minEquity = Math.min(...normalizedEquityCurve.map(p => p.value));
  const maxEquity = Math.max(...normalizedEquityCurve.map(p => p.value));
  const BASELINE = 100000;
  const INCREMENT = 2500;
  
  // Calculate axis bounds
  const maxDiff = Math.max(Math.abs(maxEquity - BASELINE), Math.abs(minEquity - BASELINE));
  const numIncrements = Math.ceil(maxDiff / INCREMENT) || 1;
  const yAxisMin = BASELINE - numIncrements * INCREMENT;
  const yAxisMax = BASELINE + numIncrements * INCREMENT;
  const yAxisRange = yAxisMax - yAxisMin || 1; // prevent divide-by-zero
  
  // Generate Y-axis labels
  const yAxisLabels: number[] = [];
  for (let val = yAxisMin; val <= yAxisMax; val += INCREMENT) {
    yAxisLabels.push(val);
  }
  
  // Generate Y-axis labels (no debug needed)

  const chartStartTime =
    normalizedEquityCurve[0]?.time ??
    normalizedEquityCurve[normalizedEquityCurve.length - 1]?.time ??
    0;
  const chartEndTime =
    normalizedEquityCurve[normalizedEquityCurve.length - 1]?.time ??
    normalizedEquityCurve[0]?.time ??
    0;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-5xl w-full max-h-[85vh] overflow-y-auto" showCloseButton={true}>
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold">
            AI Backtest (Simulation) — {symbol} — Last {horizonDays} Days
          </DialogTitle>
        </DialogHeader>

        {/* KPI Row */}
        <TooltipProvider>
          <div className="grid grid-cols-5 gap-3">
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-1 text-sm text-foreground/70 mb-1">
                <span>Total Return</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InfoIcon className="h-3 w-3 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs max-w-xs">Total portfolio return. Started with $100k, this is the % gain/loss after all trades.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className={`text-2xl font-bold ${totalReturn >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatPercent(totalReturn)}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-1 text-sm text-foreground/70 mb-1">
                <span>Win Rate</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InfoIcon className="h-3 w-3 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs max-w-xs">% of trades that were profitable. Higher is better.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="text-2xl font-bold">{(winRate ?? 0).toFixed(1)}%</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-1 text-sm text-foreground/70 mb-1">
                <span>Max Drawdown</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InfoIcon className="h-3 w-3 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs max-w-xs">Largest peak-to-trough decline. Shows worst-case loss from a high point.</p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="text-2xl font-bold text-red-600">
                -{(maxDrawdown ?? 0).toFixed(2)}%
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-1 text-sm text-foreground/70 mb-1">
                <span>{stats.avgR !== undefined ? 'Avg R' : 'Trades'}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InfoIcon className="h-3 w-3 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs max-w-xs">
                      {stats.avgR !== undefined 
                        ? 'Average R-multiple per trade. R = Risk unit (SL distance). Positive = profitable on average.'
                        : 'Number of trades executed by the AI logic. Low count means selective/quality-focused.'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className={`text-2xl font-bold ${stats.avgR !== undefined && stats.avgR >= 0 ? 'text-green-600' : stats.avgR !== undefined && stats.avgR < 0 ? 'text-red-600' : ''}`}>
                {stats.avgR !== undefined ? formatR(stats.avgR) : totalTrades}
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="flex items-center gap-1 text-sm text-foreground/70 mb-1">
                <span>{stats.tp1HitRate !== undefined ? 'TP1 Hit' : 'Days'}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InfoIcon className="h-3 w-3 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs max-w-xs">
                      {stats.tp1HitRate !== undefined
                        ? 'Percentage of trades that hit first Take Profit target (TP1). Shows execution consistency.'
                        : 'Market-open days from today backwards ' + horizonDays + ' days (excludes weekends/holidays).'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="text-2xl font-bold">
                {stats.tp1HitRate !== undefined ? `${(stats.tp1HitRate ?? 0).toFixed(1)}%` : horizonDays}
              </div>
            </div>
          </div>
        </TooltipProvider>
        
        {/* Engine-Specific Metrics Row (if available) */}
        {(stats.tp2HitRate !== undefined || stats.bestTradeR !== undefined || stats.sharpeRatio !== undefined) && (
          <TooltipProvider>
            <div className="grid grid-cols-5 gap-3">
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1 text-sm text-foreground/70 mb-1">
                  <span>TP2 Hit Rate</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InfoIcon className="h-3 w-3 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs max-w-xs">Percentage of trades that hit second Take Profit target (TP2). Shows ability to capture extended moves.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="text-2xl font-bold">
                  {stats.tp2HitRate !== undefined ? `${stats.tp2HitRate.toFixed(1)}%` : '-'}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1 text-sm text-foreground/70 mb-1">
                  <span>Best Trade</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InfoIcon className="h-3 w-3 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs max-w-xs">Best single trade in R-multiples. Shows maximum upside capture.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="text-2xl font-bold text-green-600">
                  {stats.bestTradeR !== undefined ? formatR(stats.bestTradeR) : '-'}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1 text-sm text-foreground/70 mb-1">
                  <span>Worst Trade</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InfoIcon className="h-3 w-3 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs max-w-xs">Worst single trade in R-multiples. Shows risk control effectiveness.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="text-2xl font-bold text-red-600">
                  {stats.worstTradeR !== undefined ? formatR(stats.worstTradeR) : '-'}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1 text-sm text-foreground/70 mb-1">
                  <span>Sharpe Ratio</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InfoIcon className="h-3 w-3 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs max-w-xs">Risk-adjusted return metric. &gt;1.0 is good, &gt;2.0 is excellent. Higher = better return per unit of risk.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className={`text-2xl font-bold ${(stats.sharpeRatio ?? 0) >= 1 ? 'text-green-600' : ''}`}>
                  {stats.sharpeRatio !== undefined ? stats.sharpeRatio.toFixed(2) : '-'}
                </div>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1 text-sm text-foreground/70 mb-1">
                  <span>Total Trades</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InfoIcon className="h-3 w-3 cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs max-w-xs">Number of trades executed. Low count means selective/quality-focused.</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="text-2xl font-bold">{totalTrades}</div>
              </div>
            </div>
          </TooltipProvider>
        )}

        {/* Equity Curve */}
        <div className="rounded-lg border p-6">
          <h3 className="font-semibold mb-4">Portfolio Equity Over Time</h3>
          <div className="relative">
            {/* Y-axis label */}
            <div className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 text-xs font-medium text-foreground/80 whitespace-nowrap">
              Portfolio Value (USD)
            </div>
            
            {/* Y-axis values */}
            <div className="absolute left-4 top-0 h-80 w-28 flex flex-col justify-between text-xs text-foreground/70 z-10">
              {yAxisLabels.slice().reverse().map((label, idx) => (
                <span key={idx} className="text-right font-medium">{formatCurrency(label)}</span>
              ))}
            </div>
            
            {/* Chart */}
            <div className="h-80 ml-36 mr-4 bg-white rounded border flex items-end relative">
              {normalizedEquityCurve.length > 0 && (
                <>
                <svg className="w-full h-full absolute inset-0" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {/* Grid lines - one for each $2,500 increment */}
                  {yAxisLabels.map((label, idx) => {
                    const yPercent = ((yAxisMax - label) / yAxisRange) * 100;
                    const isBaseline = label === BASELINE;
                    return (
                      <line
                        key={idx}
                        x1="0"
                        y1={yPercent}
                        x2="100"
                        y2={yPercent}
                        stroke={isBaseline ? "#3b82f6" : "#e5e7eb"}
                        strokeWidth={isBaseline ? "0.3" : "0.15"}
                        strokeDasharray={isBaseline ? "" : "2,2"}
                      />
                    );
                  })}

                  {/* Equity curve */}
                  <polyline
                    fill="none"
                    stroke="#10b981"
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                    points={normalizedEquityCurve
                      .map((point, i) => {
                        const x = (i / (normalizedEquityCurve.length - 1)) * 100;
                        const y = ((yAxisMax - point.value) / yAxisRange) * 100;
                        return `${x},${y}`;
                      })
                      .join(" ")}
                  />
                  
                </svg>
                
                {/* Trade markers as HTML overlays */}
                {trades.map((trade, idx) => {
                  const markers = [];
                  
                  // Entry marker
                  if (trade.openedAt) {
                    const openTime = new Date(trade.openedAt).getTime();
                    let closestIdx = 0;
                    let minDiff = Infinity;
                    normalizedEquityCurve.forEach((point, i) => {
                      const diff = Math.abs(point.time - openTime);
                      if (diff < minDiff) {
                        minDiff = diff;
                        closestIdx = i;
                      }
                    });
                    
                    const xPercent = (closestIdx / (normalizedEquityCurve.length - 1)) * 100;
                    const yPercent = ((yAxisMax - normalizedEquityCurve[closestIdx].value) / yAxisRange) * 100;
                    
                    markers.push(
                      <div
                        key={`entry-${idx}`}
                        className="absolute w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-[6px] border-2 border-white"
                        style={{
                          left: `${xPercent}%`,
                          top: `${yPercent}%`,
                          transform: 'translate(-50%, -50%)'
                        }}
                      >
                        E
                      </div>
                    );
                  }
                  
                  // Exit marker (TP or SL only)
                  if (trade.closedAt && (trade.exitReason === "TAKE_PROFIT" || trade.exitReason === "STOP_LOSS")) {
                    const closeTime = new Date(trade.closedAt).getTime();
                    let closestIdx = 0;
                    let minDiff = Infinity;
                    normalizedEquityCurve.forEach((point, i) => {
                      const diff = Math.abs(point.time - closeTime);
                      if (diff < minDiff) {
                        minDiff = diff;
                        closestIdx = i;
                      }
                    });
                    
                    const xPercent = (closestIdx / (normalizedEquityCurve.length - 1)) * 100;
                    const yPercent = ((yAxisMax - normalizedEquityCurve[closestIdx].value) / yAxisRange) * 100;
                    const isTP = trade.exitReason === "TAKE_PROFIT";
                    
                    markers.push(
                      <div
                        key={`exit-${idx}`}
                        className="absolute w-5 h-5 rounded-full flex items-center justify-center text-white font-bold text-[5px] border-2 border-white"
                        style={{
                          backgroundColor: isTP ? '#f59e0b' : '#dc2626',
                          left: `${xPercent}%`,
                          top: `${yPercent}%`,
                          transform: 'translate(-50%, -50%)'
                        }}
                      >
                        {isTP ? 'TP' : 'SL'}
                      </div>
                    );
                  }
                  
                  return markers;
                })}
                </>
              )}
            </div>
            
            {/* X-axis label */}
            <div className="text-center text-xs font-medium text-foreground/80 mt-3 ml-32 mr-4">
              Time (Trading Days)
            </div>
            
            {/* X-axis values */}
            <div className="flex justify-between text-xs text-foreground/70 mt-1 ml-32 mr-4">
              <span>{new Date(chartStartTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              <span className="text-foreground/50">Day {Math.floor(normalizedEquityCurve.length / 2)}</span>
              <span>{new Date(chartEndTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
            </div>
            
            {/* Legend */}
            <div className="flex items-center justify-center gap-6 mt-4 text-xs">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold text-[8px]">E</div>
                <span className="text-foreground/70">Entry</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-full flex items-center justify-center text-white font-bold text-[7px]" style={{backgroundColor: '#f59e0b'}}>TP</div>
                <span className="text-foreground/70">Take Profit</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded-full bg-red-600 flex items-center justify-center text-white font-bold text-[7px]">SL</div>
                <span className="text-foreground/70">Stop Loss</span>
              </div>
            </div>
          </div>
        </div>

        {/* Trades Table */}
        <div className="rounded-lg border">
          <div className="p-4 border-b bg-muted/30">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">Trade History</h3>
              <span className="text-sm text-foreground/70">
                {trades.length} {trades.length === 1 ? 'trade' : 'trades'} executed
              </span>
            </div>
          </div>
          {trades.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p>
                No trades were taken by our logic during this period. This usually means conditions
                were not favorable or the symbol did not match our setups. This is normal and
                indicates the model is selective.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left text-sm font-semibold text-foreground/80">Direction</th>
                    <th className="px-4 py-2 text-left text-sm font-semibold text-foreground/80">Entry → Exit</th>
                    <th className="px-4 py-2 text-left text-sm font-semibold text-foreground/80">Position PnL</th>
                    <th className="px-4 py-2 text-left text-sm font-semibold text-foreground/80">Exit Reason</th>
                    <th className="px-4 py-2 text-left text-sm font-semibold text-foreground/80">Duration</th>
                    <th className="px-4 py-2 text-left text-sm font-semibold text-foreground/80">Opened / Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((trade, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="px-4 py-3 text-sm">
                        <span className={trade.direction === "LONG" ? "text-green-600" : "text-red-600"}>
                          {trade.direction}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">
                        ${trade.entryPrice.toFixed(2)} → ${trade.exitPrice?.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={(trade.pnlPct || 0) >= 0 ? "text-green-600" : "text-red-600"}>
                          {formatPercent(trade.pnlPct || 0)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <span className={
                          trade.exitReason === "TAKE_PROFIT" ? "text-green-600 font-medium" :
                          trade.exitReason === "STOP_LOSS" ? "text-red-600 font-medium" :
                          "text-foreground/70 font-medium"
                        }>
                          {trade.exitReason === "TAKE_PROFIT" ? "Take Profit" :
                           trade.exitReason === "STOP_LOSS" ? "Stopped Out" :
                           "Period End"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm font-medium">
                        {trade.durationHours ? `${(trade.durationHours / 24).toFixed(1)}d` : "-"}
                      </td>
                      <td className="px-4 py-3 text-sm text-foreground/70">
                        <div>{new Date(trade.openedAt).toLocaleDateString()}</div>
                        <div className="text-xs">
                          {trade.closedAt ? new Date(trade.closedAt).toLocaleDateString() : "Open"}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer Disclaimer */}
        <div className="text-xs text-foreground/90 border-t pt-4 space-y-2">
          <p className="font-bold text-foreground">IMPORTANT DISCLAIMER:</p>
          <p>
            Backtested performance is based on a fixed, rules-based model strategy.
            It is NOT a recreation of past AI signals.
            Results are hypothetical, do not reflect actual trading, and may differ
            substantially from real performance.
            Past performance is not indicative of future results.
            Trading involves risk of loss.
          </p>
          <p>
            This feature provides model-based analytics only.
            Nothing shown constitutes financial advice, investment guidance, or
            recommendations to buy or sell any assets.
          </p>
          <p className="italic">
            These results are derived from a standardized simulation applied
            retrospectively to historical market data.
            They should not be interpreted as a guarantee of future performance
            or as personalized investment advice.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
