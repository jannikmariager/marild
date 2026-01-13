"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface DaySummary {
  date: string; // YYYY-MM-DD
  strategy: string;
  total_pnl: number;
  trades_count: number;
  winners: number;
  losers: number;
  flats: number;
}

interface JournalTrade {
  ticker: string;
  strategy: string;
  side: "LONG" | "SHORT";
  entry_timestamp: string;
  entry_price: number;
  exit_timestamp: string | null;
  exit_price: number | null;
  size_shares: number;
  realized_pnl_dollars: number;
  realized_pnl_r: number | null;
  exit_reason: string | null;
}

interface JournalResponse {
  strategy: string;
  days: DaySummary[];
  tradesByDay: Record<string, JournalTrade[]>;
  totals: {
    starting_equity: number;
    current_equity: number;
    since_inception_realized_pnl: number;
    current_unrealized_pnl: number;
    since_inception_total_pnl: number;
  };
  meta: {
    lookback_days: number;
    total_trading_days: number;
    total_trades: number;
  };
}

const monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatDateLabel(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function TradingJournalPage() {
  // Strategy is fixed to the single live engine (SWING) – UI toggle removed.
  const [strategy] = useState<"SWING" | "DAYTRADE">("SWING");
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [data, setData] = useState<JournalResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [showOptimizationOnly, setShowOptimizationOnly] = useState(false);

  // Load journal data (lookback window covers several months; we slice per calendar month on client)
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ strategy, days: "120" });
        const res = await fetch(`/api/performance/journal?${params.toString()}`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load journal: ${res.status}`);
        }
        const json = (await res.json()) as JournalResponse;
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load trading journal");
        setData(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [strategy]);

  const dayIndex = useMemo(() => {
    const map = new Map<string, DaySummary>();
    if (data?.days) {
      for (const d of data.days) {
        map.set(d.date, d);
      }
    }
    return map;
  }, [data]);

  const tradesByDay = data?.tradesByDay || {};

  // Build calendar grid for currentMonth
  const calendar = useMemo(() => {
    const year = currentMonth.getUTCFullYear();
    const month = currentMonth.getUTCMonth();
    const firstOfMonth = new Date(Date.UTC(year, month, 1));
    const firstWeekday = firstOfMonth.getUTCDay(); // 0-6
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    const cells: Array<{ date: Date | null }> = [];

    // Leading blanks
    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ date: null });
    }
    // Actual days
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({ date: new Date(Date.UTC(year, month, day)) });
    }
    return { year, month, cells };
  }, [currentMonth]);

  const currentMonthKey = getMonthKey(currentMonth);

  // Selected day trades & summary
  const selectedSummary = selectedDayKey ? dayIndex.get(selectedDayKey) || null : null;
  const selectedTradesAll = selectedDayKey ? tradesByDay[selectedDayKey] || [] : [];
  const selectedTrades = showOptimizationOnly
    ? selectedTradesAll.filter((t) =>
        t.exit_reason === 'CAPITAL_RECYCLE_LOW_MOMENTUM' || t.exit_reason === 'SLOT_RELEASE_REPLACEMENT',
      )
    : selectedTradesAll;

  const handlePrevMonth = () => {
    const d = new Date(currentMonth);
    d.setUTCMonth(d.getUTCMonth() - 1);
    setCurrentMonth(d);
    setSelectedDayKey(null);
  };

  const handleNextMonth = () => {
    const d = new Date(currentMonth);
    d.setUTCMonth(d.getUTCMonth() + 1);
    setCurrentMonth(d);
    setSelectedDayKey(null);
  };

  const monthTitle = `${monthNames[calendar.month]} ${calendar.year}`;

  const totals = data?.totals;

  const yesterdayKey = useMemo(() => {
    // Align with backend: backend groups trades by UTC date (toISOString slice 0-10)
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }, []);

  const yesterdayPnl = dayIndex.get(yesterdayKey)?.total_pnl ?? 0;

  const weekStartKey = useMemo(() => {
    // Align with backend: compute week start using UTC calendar date
    const d = new Date();
    const day = d.getUTCDay(); // 0 (Sun) .. 6 (Sat)
    const diffToMonday = (day + 6) % 7; // Mon=0, Tue=1, ... Sun=6
    d.setUTCDate(d.getUTCDate() - diffToMonday);
    return d.toISOString().slice(0, 10);
  }, []);

  const thisWeekPnl = useMemo(() => {
    if (!data?.days?.length) return 0;

    const weekDays = data.days.filter((d) => d.date >= weekStartKey);
    if (weekDays.length) {
      console.log('[Journal] thisWeek days:', weekDays.map((d) => ({ date: d.date, pnl: d.total_pnl })));
    }

    return weekDays.reduce((sum, d) => sum + (d.total_pnl || 0), 0);
  }, [data, weekStartKey]);

  return (
    <div className="container max-w-7xl mx-auto px-4 py-8 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Trading Journal</h1>
        <p className="text-gray-600 text-sm md:text-base max-w-3xl">
          Calendar-based record of the model portfolios&apos; daily P&amp;L. Every trading day is logged — wins,
          losses, and flat days alike. Read-only, for transparency and auditability.
        </p>
      </header>

      <section className="flex flex-col lg:grid lg:grid-cols-[minmax(0,2.8fr)_minmax(0,1.2fr)] lg:items-start gap-6">
        {/* Calendar column */}
        <Card className="w-full">
          <CardHeader className="flex flex-col gap-2 space-y-0 pb-4">
            <div className="flex flex-row items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-base font-semibold text-gray-900">Daily P&amp;L Calendar</CardTitle>
                <p className="text-xs text-gray-500">
                  Grouped by trade exit date. Grey days indicate no trades.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                  Yesterday (realized)
                </p>
                <p
                  className={cn(
                    "font-mono text-base font-semibold",
                    yesterdayPnl > 0 ? "text-green-700" : yesterdayPnl < 0 ? "text-red-700" : "text-gray-800",
                  )}
                >
                  {yesterdayPnl >= 0 ? "+" : ""}
                  {yesterdayPnl.toFixed(2)}$
                </p>
              </div>
              <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                  This week (realized)
                </p>
                <p
                  className={cn(
                    "font-mono text-base font-semibold",
                    thisWeekPnl > 0 ? "text-green-700" : thisWeekPnl < 0 ? "text-red-700" : "text-gray-800",
                  )}
                >
                  {thisWeekPnl >= 0 ? "+" : ""}
                  {thisWeekPnl.toFixed(2)}$
                </p>
              </div>
              <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                  Since inception (matches Live)
                </p>
                <p
                  className={cn(
                    "font-mono text-base font-semibold",
                    (totals?.since_inception_total_pnl ?? 0) > 0
                      ? "text-green-700"
                      : (totals?.since_inception_total_pnl ?? 0) < 0
                      ? "text-red-700"
                      : "text-gray-800",
                  )}
                >
                  {(totals?.since_inception_total_pnl ?? 0) >= 0 ? "+" : ""}
                  {(totals?.since_inception_total_pnl ?? 0).toFixed(2)}$
                </p>
                {totals && (
                  <p className="text-[11px] text-gray-500">
                    Realized{" "}
                    {(totals.since_inception_realized_pnl >= 0 ? "+" : "") +
                      totals.since_inception_realized_pnl.toFixed(2)}
                    $ · Unrealized{" "}
                    {(totals.current_unrealized_pnl >= 0 ? "+" : "") +
                      totals.current_unrealized_pnl.toFixed(2)}
                    $
                  </p>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handlePrevMonth}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleNextMonth}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="text-sm font-semibold text-gray-800">{monthTitle}</div>
            </div>

            {loading ? (
              <p className="text-sm text-gray-600">Loading trading journal...</p>
            ) : error ? (
              <p className="text-sm text-red-600">{error}</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-7 gap-1.5 text-sm text-gray-500 text-center">
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                    <div key={d}>{d}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1.5 text-xs">
                  {calendar.cells.map((cell, idx) => {
                    if (!cell.date) {
                      return <div key={idx} className="h-20 rounded border border-transparent" />;
                    }
                    const dateKey = cell.date.toISOString().slice(0, 10);
                    const summary = dayIndex.get(dateKey) || null;
                    const isSelected = selectedDayKey === dateKey;

                    let bg = "bg-gray-50 border-gray-100";
                    let text = "text-gray-700";
                    if (summary) {
                      if (summary.total_pnl > 0) {
                        bg = "bg-green-50 border-green-200";
                        text = "text-green-800";
                      } else if (summary.total_pnl < 0) {
                        bg = "bg-red-50 border-red-200";
                        text = "text-red-800";
                      } else {
                        bg = "bg-gray-50 border-gray-200";
                        text = "text-gray-700";
                      }
                    } else {
                      // No trades on this day
                      bg = "bg-gray-50 border-dashed border-gray-200";
                      text = "text-gray-400";
                    }

                    const border = isSelected ? "ring-2 ring-gray-900" : "border";

                    const content = (
                      <button
                        type="button"
                        onClick={() => setSelectedDayKey(dateKey)}
                        className={cn(
                          "flex h-20 w-full flex-col items-start justify-between rounded px-2.5 py-2 text-left transition-colors",
                          bg,
                          border,
                        )}
                      >
                        <span className={cn("text-sm font-semibold", text)}>{cell.date.getUTCDate()}</span>
                        {summary ? (
                          <span className={cn("text-sm font-mono", text)}>
                            {summary.total_pnl >= 0 ? "+" : ""}
                            {summary.total_pnl.toFixed(0)}$
                          </span>
                        ) : (
                          <span className="text-[10px] text-gray-400">No trades</span>
                        )}
                      </button>
                    );

                    if (!summary) {
                      return <div key={dateKey}>{content}</div>;
                    }

                    return (
                      <Tooltip key={dateKey}>
                        <TooltipTrigger asChild>{content}</TooltipTrigger>
                        <TooltipContent className="text-xs">
                          <div className="font-semibold mb-1">{formatDateLabel(dateKey)}</div>
                          <div>{summary.trades_count} trades</div>
                          <div>
                            {summary.winners} wins / {summary.losers} losses / {summary.flats} flat
                          </div>
                          <div className="mt-1 font-mono">
                            P&amp;L: {summary.total_pnl >= 0 ? "+" : ""}
                            {summary.total_pnl.toFixed(2)}$
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Day detail column */}
        <Card className="w-full max-w-full">
            <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base font-semibold text-gray-900">Day detail</CardTitle>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">Show:</span>
                <div className="inline-flex rounded-full border border-gray-200 bg-gray-50 p-1">
                  <button
                    type="button"
                    onClick={() => setShowOptimizationOnly(false)}
                    className={cn(
                      'px-2 py-0.5 rounded-full text-[11px] font-medium',
                      !showOptimizationOnly
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-500 hover:text-gray-800',
                    )}
                  >
                    All
                  </button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => setShowOptimizationOnly(true)}
                        className={cn(
                          'px-2 py-0.5 rounded-full text-[11px] font-medium',
                          showOptimizationOnly
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-500 hover:text-gray-800',
                        )}
                      >
                        Optimization exits
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs text-[11px]">
                      <p className="font-semibold mb-1">Optimization exits only</p>
                      <p>
                        Shows trades closed by the live engine to recycle capital when momentum stalled after securing
                        profit.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {!selectedSummary ? (
              <p className="text-sm text-gray-500">
                Select a trading day in the calendar to see executed trades and P&amp;L. Days without trades are shown
                in grey.
              </p>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Date</p>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatDateLabel(selectedSummary.date)}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Net P&amp;L</p>
                    <p
                      className={cn(
                        "text-base font-semibold",
                        selectedSummary.total_pnl > 0
                          ? "text-green-700"
                          : selectedSummary.total_pnl < 0
                          ? "text-red-700"
                          : "text-gray-800",
                      )}
                    >
                      {selectedSummary.total_pnl >= 0 ? "+" : ""}
                      {selectedSummary.total_pnl.toFixed(2)}$
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Discipline note</p>
                    <p className="text-xs text-gray-600">
                      {selectedSummary.trades_count === 0
                        ? "No trades executed — conditions did not meet risk criteria."
                        : "Every trade is recorded here for full transparency."}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Trades</p>
                    <p className="text-sm text-gray-900">
                      {selectedSummary.trades_count} total — {selectedSummary.winners} wins /{" "}
                      {selectedSummary.losers} losses
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Executed trades</p>
                  {selectedTrades.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      No trades executed — the model did not find setups that met the risk criteria on this day.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
                      {selectedTrades.map((t, idx) => {
                        const pnlColor =
                          t.realized_pnl_dollars > 0
                            ? "text-green-700"
                            : t.realized_pnl_dollars < 0
                            ? "text-red-700"
                            : "text-gray-700";

                        const exitReason = (t.exit_reason || "").toUpperCase();
                        const isOptimizationExit =
                          exitReason === 'CAPITAL_RECYCLE_LOW_MOMENTUM' || exitReason === 'SLOT_RELEASE_REPLACEMENT';
                        const isTimeExitSideways = exitReason === 'TIME_EXIT_PRE_CLOSE_SIDEWAYS';

                        let exitLabel = "Other";
                        let exitClass = "border-gray-300 bg-gray-50 text-gray-700";

                        if (isOptimizationExit) {
                          exitLabel = "OPTIMIZATION";
                          exitClass = "border-indigo-300 bg-indigo-50 text-indigo-700";
                        } else if (isTimeExitSideways) {
                          exitLabel = "TIME EXIT";
                          exitClass = "border-amber-300 bg-amber-50 text-amber-700";
                        } else if (exitReason.includes("TP")) {
                          exitLabel = "TP";
                          exitClass = "border-emerald-300 bg-emerald-50 text-emerald-700";
                        } else if (exitReason.includes("TRAILING")) {
                          exitLabel = "TRAILING SL";
                          exitClass = "border-blue-300 bg-blue-50 text-blue-700";
                        } else if (exitReason.includes("SL")) {
                          exitLabel = "SL";
                          exitClass = "border-red-300 bg-red-50 text-red-700";
                        }

                        const exitTime = t.exit_timestamp
                          ? new Date(t.exit_timestamp).toLocaleTimeString("en-US", {
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })
                          : null;

                        return (
                          <div
                            key={`${t.ticker}-${t.entry_timestamp}-${idx}`}
                            className="rounded border border-gray-200 bg-gray-50 px-2.5 py-2 text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-sm text-gray-900">{t.ticker}</span>
                                <span
                                  className={cn(
                                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
                                    t.side === "SHORT"
                                      ? "border-red-300 bg-red-50 text-red-700"
                                      : "border-emerald-300 bg-emerald-50 text-emerald-700",
                                  )}
                                >
                                  {t.side}
                                </span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      className={cn(
                                        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold',
                                        exitClass,
                                      )}
                                    >
                                      {exitLabel}
                                    </span>
                                  </TooltipTrigger>
                                  {isOptimizationExit && (
                                    <TooltipContent side="bottom" className="max-w-xs text-[11px]">
                                      <p className="font-semibold mb-1">Capital recycled (partial)</p>
                                      <p>
                                        This trade was partially closed because momentum stalled after profit was
                                        secured. Capital was freed for higher-quality opportunities while keeping a
                                        runner open.
                                      </p>
                                    </TooltipContent>
                                  )}
                                  {isTimeExitSideways && (
                                    <TooltipContent side="bottom" className="max-w-xs text-[11px]">
                                      <p className="font-semibold mb-1">Time exit before close</p>
                                      <p>
                                        This trade was fully closed shortly before market close because it remained in
                                        profit but momentum stalled and price moved sideways for several hours.
                                      </p>
                                    </TooltipContent>
                                  )}
                                </Tooltip>
                              </div>
                              <span className={cn("font-mono text-xs", pnlColor)}>
                                {t.realized_pnl_dollars >= 0 ? "+" : ""}
                                {t.realized_pnl_dollars.toFixed(2)}$
                                {t.realized_pnl_r !== null && (
                                  <span className="text-gray-500"> — {t.realized_pnl_r.toFixed(2)}R</span>
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[11px] text-gray-600">
                              <span>
                                Entry {t.entry_price?.toFixed(2)} — Exit {t.exit_price?.toFixed(2)}
                              </span>
                              <span>{t.size_shares} shares</span>
                            </div>
                            <div className="flex items-center justify-between gap-2 text-[10px] text-gray-500">
                              <span>
                                Exit reason: {t.exit_reason || "UNKNOWN"}
                              </span>
                              {exitTime && <span className="font-mono text-[10px] text-gray-500">{exitTime}</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}