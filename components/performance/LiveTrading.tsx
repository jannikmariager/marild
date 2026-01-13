'use client';

import { useMemo, useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RiskRewardBar, getRiskState } from '@/components/performance/RiskRewardBar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshCw, TrendingUp, TrendingDown, DollarSign, Activity, Info } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { RiskSummary, type RiskSummaryData } from '@/components/performance/RiskSummary';
import ProLockedCard from '@/components/feed/ProLockedCard';
import { TradeGateBadge } from '@/components/trade-gate-badge';

interface LivePortfolioData {
  strategy: string;
  equity_curve: Array<{
    timestamp: string;
    equity: number;
    cash: number;
    unrealized_pnl: number;
    open_positions_count: number;
  }>;
  open_positions: Array<{
    ticker: string;
    side: 'LONG' | 'SHORT';
    entry_timestamp: string;
    entry_price: number;
    current_price: number;
    size_shares: number;
    notional_at_entry: number;
    stop_loss: number;
    take_profit: number;
    unrealized_pnl: number;
    unrealized_pnl_R: number;
    risk_dollars: number;
    signal_entry_price?: number;
    signal_stop_loss?: number;
    signal_tp1?: number;
    signal_tp2?: number;
    signal_created_at?: string;
    has_recycled_capital?: boolean;
  }>;
  today_trades: Array<{
    ticker: string;
    side: 'LONG' | 'SHORT';
    entry_timestamp: string;
    entry_price: number;
    exit_timestamp: string;
    exit_price: number;
    exit_reason: string;
    size_shares: number;
    realized_pnl: number;
    realized_pnl_R: number;
  }>;
  // Recent closed trades (API returns last 30 days) used for timeframe-filtered metrics
  recent_trades?: Array<{
    ticker: string;
    side: 'LONG' | 'SHORT';
    entry_timestamp: string;
    exit_timestamp: string;
    exit_reason: string;
    realized_pnl: number;
  }>;
  stats: {
    current_equity: number;
    total_pnl: number;
    total_pnl_pct: number;
    win_rate_closed: number | null;
    avg_trade_return_pct: number | null;
    profit_factor: number | null;
    total_trades: number;
    today_pnl: number;
    today_trades: number;
    open_positions_count: number;
    cash_available: number;
    trading_days?: number;
    period_start?: string | null;
    period_end?: string | null;
  };
  risk_summary?: RiskSummaryData | null;
  access?: {
    is_locked: boolean;
  };
}

type TimeframeMode = 'today' | '7d' | '30d' | 'since_start';

const STARTING_EQUITY = 100000;

const TRADING_TZ = 'America/New_York';

function dayKeyInTimeZone(isoTs: string, timeZone: string) {
  const d = new Date(isoTs);
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  // en-CA yields YYYY-MM-DD with 2-digit month/day
  return dtf.format(d);
}

function shiftDateKey(dateKey: string, deltaDays: number) {
  // dateKey is YYYY-MM-DD
  const base = new Date(dateKey + 'T00:00:00Z');
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

function getNyClockMinutes(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TRADING_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hh * 60 + mm;
}

function isWeekdayNy(d: Date) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TRADING_TZ, weekday: 'short' }).format(d);
  return weekday !== 'Sat' && weekday !== 'Sun';
}

function isMarketSessionLikelyOpenNy(now: Date) {
  // Approx regular session: 09:30–16:00 America/New_York.
  // We intentionally do not try to handle holidays here.
  if (!isWeekdayNy(now)) return false;
  const minutes = getNyClockMinutes(now);
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return minutes >= open && minutes <= close;
}

function isWithinRegularSessionNy(tsIso: string) {
  const d = new Date(tsIso);
  if (!isWeekdayNy(d)) return false;
  const minutes = getNyClockMinutes(d);
  const open = 9 * 60 + 30;
  const close = 16 * 60;
  return minutes >= open && minutes <= close;
}

function formatMonthDay(dateStr: string) {
  // dateStr is YYYY-MM-DD
  const d = new Date(dateStr + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


import { getActiveEngine } from '@/lib/performance';

interface LiveTradingProps {
  isPro?: boolean;
}

export default function LiveTrading({ isPro = false }: LiveTradingProps = {}) {
  const [timeframe, setTimeframe] = useState<TimeframeMode>('since_start');
  const [data, setData] = useState<LivePortfolioData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeEngine = getActiveEngine(); // currently always 'swing'

  useEffect(() => {
    loadData();
    // Refresh every 1 minute for more accurate live P&L and prices
    const interval = setInterval(() => loadData(), 60000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    try {
      setIsLoading(true);
      // Backend already normalizes invalid/legacy strategies to the active engine.
      const response = await fetch(`/api/live-portfolio?strategy=SWING`);
      if (!response.ok) {
        throw new Error('Failed to load live portfolio data');
      }
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading data');
    } finally {
      setIsLoading(false);
    }
  }

  type EquityCurvePoint = LivePortfolioData['equity_curve'][number];
  type DailyEodPoint = { date: string; equity: number; lastTimestamp: string };
  type ChartDatum = { x: string; equity: number };

  const curve: EquityCurvePoint[] = useMemo(() => data?.equity_curve || [], [data?.equity_curve]);

  const portfolioStartDay = useMemo(() => {
    if (curve.length === 0) return null;
    // Attribute portfolio start to the trading-day (US/Eastern) to avoid UTC date rollover.
    return dayKeyInTimeZone(curve[0].timestamp, TRADING_TZ);
  }, [curve]);

  const todayTradingDay = useMemo(() => {
    return dayKeyInTimeZone(new Date().toISOString(), TRADING_TZ);
  }, []);

  const marketOpenNow = useMemo(() => isMarketSessionLikelyOpenNy(new Date()), []);

  const intradayData: EquityCurvePoint[] = useMemo(() => {
    // Intraday should reflect the *market session* (not midnight-to-midnight).
    // If the market is closed (weekend/after-hours), keep this empty so "Today" doesn't show yesterday's move.
    if (!marketOpenNow) return [];

    return curve.filter(
      (p) =>
        dayKeyInTimeZone(p.timestamp, TRADING_TZ) === todayTradingDay &&
        isWithinRegularSessionNy(p.timestamp),
    );
  }, [curve, todayTradingDay, marketOpenNow]);

  const dailyEodData: DailyEodPoint[] = useMemo(() => {
    // Daily EOD points = last snapshot of each trading day (US/Eastern)
    // This prevents e.g. Dec 12 performance being labeled as Dec 13 due to UTC rollover.
    const byDay = new Map<string, DailyEodPoint>();

    for (const p of curve) {
      const key = dayKeyInTimeZone(p.timestamp, TRADING_TZ);
      byDay.set(key, { date: key, equity: p.equity, lastTimestamp: p.timestamp });
    }

    const days = Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));

    // Ensure we include the first trading day even if flat / only one point
    if (portfolioStartDay && curve.length > 0 && !byDay.has(portfolioStartDay)) {
      const first = curve[0];
      days.unshift({ date: portfolioStartDay, equity: first.equity, lastTimestamp: first.timestamp });
    }

    return days;
  }, [curve, portfolioStartDay]);

  const chartMode = timeframe;

  const chartData: ChartDatum[] = useMemo(() => {
    if (chartMode === 'today') {
      // Today: show intraday points only when market is open; otherwise fall back to last trading-day close.
      if (intradayData.length > 0) {
        return intradayData.map((p) => ({
          x: p.timestamp,
          equity: p.equity,
        }));
      }
      // No intraday data — use last trading day close as a single point.
      if (dailyEodData.length > 0) {
        const last = dailyEodData[dailyEodData.length - 1];
        return [{ x: last.date, equity: last.equity }];
      }
      return [];
    }

    // For 7D/30D we show trading days only (no weekend/holiday gaps).
    const daysBack = chartMode === '7d' ? 7 : chartMode === '30d' ? 30 : null;

    if (!daysBack) {
      // Since start: use all trading days we have.
      return dailyEodData.map((d) => ({ x: d.date, equity: d.equity }));
    }

    const lastIdx = dailyEodData.length - 1;
    if (lastIdx < 0) return [];

    const startIdx = Math.max(0, lastIdx - (daysBack - 1));
    const slice = dailyEodData.slice(startIdx, lastIdx + 1);
    return slice.map((d) => ({ x: d.date, equity: d.equity }));
  }, [chartMode, intradayData, dailyEodData]);

  const subtitleText = useMemo(() => {
    if (chartMode !== 'today') return 'Performance since live trading began';
    return marketOpenNow ? 'Intraday equity movement' : 'Market closed — no intraday movement';
  }, [chartMode, marketOpenNow]);

  const yDomain = useMemo((): [number, number] => {
    const values = chartData.map((d) => d.equity).filter((n) => Number.isFinite(n));
    if (values.length === 0) return [STARTING_EQUITY - 500, STARTING_EQUITY + 500];

    let min = Math.min(...values);
    let max = Math.max(...values);

    // Since start should always show the baseline at $100K for honest context
    if (chartMode === 'since_start') {
      min = Math.min(min, STARTING_EQUITY);
      max = Math.max(max, STARTING_EQUITY);
    }

    const range = Math.max(1, max - min);
    // Add meaningful padding so small moves don't look like huge spikes
    const pad = Math.max(500, Math.round(range * 0.25));

    return [Math.floor(min - pad), Math.ceil(max + pad)];
  }, [chartData, chartMode]);

  const stats = data?.stats || {
    current_equity: STARTING_EQUITY,
    total_pnl: 0,
    total_pnl_pct: 0,
    win_rate_closed: null,
    avg_trade_return_pct: null,
    profit_factor: null,
    total_trades: 0,
    today_pnl: 0,
    today_trades: 0,
    open_positions_count: 0,
    cash_available: STARTING_EQUITY,
    trading_days: 0,
    period_start: null as string | null,
    period_end: null as string | null,
  };

  const timeframeLabel = useMemo(() => {
    if (chartMode === 'today') return 'Today';
    if (chartMode === '7d') return '7D';
    if (chartMode === '30d') return '30D';
    return 'Since Start';
  }, [chartMode]);

  const periodBaselineEquity = useMemo(() => {
    if (chartMode === 'today') {
      return intradayData.length > 0 ? intradayData[0].equity : stats.current_equity;
    }

    if (chartMode === 'since_start') return STARTING_EQUITY;

    // 7D/30D: chartData is calendar-filled; baseline should represent equity at the *start* of the window.
    // The first point already reflects carry-forward equity entering that day.
    return chartData.length > 0 ? chartData[0].equity : stats.current_equity;
  }, [chartMode, intradayData, chartData, stats.current_equity]);

  const periodEndEquity = useMemo(() => {
    if (chartMode === 'today') {
      return intradayData.length > 0 ? intradayData[intradayData.length - 1].equity : stats.current_equity;
    }
    return chartData.length > 0 ? chartData[chartData.length - 1].equity : stats.current_equity;
  }, [chartMode, intradayData, chartData, stats.current_equity]);

  const periodPnl = periodEndEquity - periodBaselineEquity;
  const periodPnlPct = periodBaselineEquity > 0 ? (periodPnl / periodBaselineEquity) * 100 : 0;

  const periodPnlColor = periodPnl >= 0 ? 'text-emerald-700' : 'text-red-600';

  // Global metrics are already computed on the backend from closed trades via computePortfolioMetrics.
  // We only use recent_trades locally for optional per-period diagnostics if needed in the future.
  const recentClosedTrades = useMemo(() => data?.recent_trades || [], [data?.recent_trades]);
  const isLocked = !isPro && (data?.access?.is_locked ?? false);
  const openPositions = data?.open_positions ?? [];

  if (isLoading && !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <RefreshCw className="w-8 h-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <p className="text-red-600">{error || 'No data available'}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {!isLocked && <RiskSummary summary={data?.risk_summary} />}
      {/* Single live engine: Active Signals (backed by SWING model portfolio) */}
      <Tabs value="ACTIVE_SIGNALS">
        <TabsList className="grid w-full max-w-md grid-cols-1 bg-gray-100 rounded-full p-1">
          <TabsTrigger
            value="ACTIVE_SIGNALS"
            className="rounded-full"
          >
            Active Signals ($100K)
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ACTIVE_SIGNALS" className="space-y-6 mt-6">
          <TradeGateBadge variant="compact" />
          {/* Performance Metrics */}
          <Card>
            <CardHeader>
              <CardTitle>Performance Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Top row: Current Equity + Total P&L + Win Rate */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* 1. Current Equity */}
                    <div>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                        <DollarSign className="w-4 h-4" />
                        <span>Current Equity</span>
                      </div>
                      <div className="text-3xl font-bold">${stats.current_equity.toLocaleString()}</div>
                      <p
                        className={`text-sm ${
                          stats.total_pnl >= 0 ? 'text-emerald-700' : 'text-red-600'
                        } mt-1 font-medium`}
                      >
                        {stats.total_pnl >= 0 ? '+' : ''}${stats.total_pnl.toLocaleString()} ({
                          stats.total_pnl_pct >= 0 ? '+' : ''
                        }
                        {stats.total_pnl_pct.toFixed(2)}%)
                      </p>
                      <p className="text-xs text-gray-500 mt-1">Started at $100,000</p>
                    </div>

                    {/* 2. Total P&L (Since Start) */}
                    <div>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                        <Activity className="w-4 h-4" />
                        <span>Total P&amp;L (Since Start)</span>
                      </div>
                      <div
                        className={`text-3xl font-bold ${
                          stats.total_pnl >= 0 ? 'text-emerald-700' : 'text-red-600'
                        }`}
                      >
                        {stats.total_pnl >= 0 ? '+' : ''}${Math.round(stats.total_pnl).toLocaleString()}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {stats.total_pnl_pct >= 0 ? '+' : ''}
                        {stats.total_pnl_pct.toFixed(2)}% vs $100,000 baseline
                      </p>
                    </div>

                    {/* 3. Win Rate (Closed Trades) */}
                    <div>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                        <TrendingUp className="w-4 h-4" />
                        <span>Win Rate (Closed Trades)</span>
                      </div>
                      <div className="text-3xl font-bold">
                        {stats.total_trades === 0 || stats.win_rate_closed == null
                          ? '—'
                          : `${stats.win_rate_closed.toFixed(1)}%`}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {stats.total_trades === 0
                          ? 'No closed trades yet'
                          : `${stats.total_trades} closed trades`}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Winning closed trades ÷ total closed trades.
                      </p>
                    </div>

                  </div>

                  {/* Bottom row: Avg Trade Return + Profit Factor + Trading Days */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                    {/* 4. Avg Trade Return */}
                    <div>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                        <TrendingUp className="w-4 h-4" />
                        <span>Avg Trade Return</span>
                      </div>
                      <div className="text-3xl font-bold">
                        {stats.total_trades === 0 || stats.avg_trade_return_pct == null
                          ? '—'
                          : `${stats.avg_trade_return_pct.toFixed(2)}%`}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {stats.total_trades === 0
                          ? 'No closed trades yet'
                          : `${stats.total_trades} closed trades`}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Capital-weighted average return per closed trade.
                      </p>
                    </div>

                    {/* 5. Profit Factor */}
                    <div>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                        <TrendingDown className="w-4 h-4" />
                        <span>Profit Factor</span>
                      </div>
                      <div className="text-3xl font-bold">
                        {stats.profit_factor == null || stats.total_trades === 0
                          ? '—'
                          : stats.profit_factor.toFixed(2)}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        {stats.total_trades === 0
                          ? 'No closed trades yet'
                          : 'Gross profits ÷ gross losses (closed trades).'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Ratio above 1.0 indicates profitability.
                      </p>
                    </div>

                    {/* 6. Trading Days */}
                    <div>
                      <div className="flex items-center gap-2 text-sm text-gray-600 mb-2">
                        <span>Trading Days</span>
                      </div>
                      <div className="text-3xl font-bold">
                        {stats.trading_days && stats.trading_days > 0 ? stats.trading_days : '—'}
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        Distinct market days with live portfolio activity.
                      </p>
                    </div>
                  </div>
                </div>
            </CardContent>
          </Card>

          {/* Equity Curve */}
          <Card>
            <CardHeader className="space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5" />
                    Equity Curve
                  </CardTitle>

                  {/* Keep header height stable across timeframe modes */}
                  <div className="min-h-[32px] space-y-0.5">
                    <p className="text-xs text-gray-500">{subtitleText}</p>
                    <p className="text-xs text-gray-500">
                      {chartMode === 'since_start' && portfolioStartDay
                        ? `Portfolio started ${formatMonthDay(portfolioStartDay)}`
                        : '\u00A0'}
                    </p>
                  </div>
                </div>

                {/* Timeframe selector */}
                <div className="inline-flex rounded-full border border-gray-200 bg-gray-50 p-1 text-xs">
                  <button
                    type="button"
                    onClick={() => setTimeframe('today')}
                    className={`px-3 py-1 rounded-full font-medium transition-colors ${
                      timeframe === 'today'
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    Today
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimeframe('7d')}
                    className={`px-3 py-1 rounded-full font-medium transition-colors ${
                      timeframe === '7d'
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    7D
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimeframe('30d')}
                    className={`px-3 py-1 rounded-full font-medium transition-colors ${
                      timeframe === '30d'
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    30D
                  </button>
                  <button
                    type="button"
                    onClick={() => setTimeframe('since_start')}
                    className={`px-3 py-1 rounded-full font-medium transition-colors ${
                      timeframe === 'since_start'
                        ? 'bg-gray-900 text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    Since Start
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <p className="text-gray-600 text-center py-12">No equity data available yet</p>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      dataKey="x"
                      tickFormatter={(value) => {
                        if (chartMode === 'today') {
                          return new Date(value).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                        }
                        // value is YYYY-MM-DD
                        return formatMonthDay(String(value));
                      }}
                      stroke="#9ca3af"
                      style={{ fontSize: '12px' }}
                    />
                    <YAxis
                      domain={yDomain}
                      stroke="#9ca3af"
                      style={{ fontSize: '12px' }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}K`}
                    />
                    <RechartsTooltip
                      labelFormatter={(value) => {
                        if (chartMode === 'today') return new Date(value as string).toLocaleString();
                        return new Date(String(value) + 'T00:00:00Z').toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        });
                      }}
                      formatter={(value: number) => [`$${Number(value).toLocaleString()}`, 'Equity']}
                      contentStyle={{ backgroundColor: '#ffffff', border: '1px solid #e5e7eb', borderRadius: '8px' }}
                    />
                    {/* Tooltip copy alignment for Web/Mobile */}
                    {/* Equity reflects trading days only. Weekends and market holidays are omitted. */}
                    <Line
                      type="monotone"
                      dataKey="equity"
                      stroke="#3b82f6"
                      strokeWidth={3}
                      dot={false}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Open Positions */}
          <ProLockedCard
            isLocked={isLocked}
            featureName="Live positions & trade log"
            description="Upgrade to PRO to see every live entry, stop, and take profit in real time."
          >
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>Open Positions</CardTitle>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <button className="text-slate-400 hover:text-slate-600 transition-colors">
                        <Info className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs text-xs">
                      <div className="space-y-1">
                        <p className="font-semibold">How to read the bar:</p>
                        <p>• Red = remaining risk</p>
                        <p>• Dark green = locked profit</p>
                        <p>• Light green = potential profit</p>
                        <p>• White line = entry price</p>
                        <p>• White dot = current price</p>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </CardHeader>
              <CardContent>
                {openPositions.length === 0 ? (
                  <p className="text-gray-600 text-center py-8">No open positions</p>
                ) : (
                  <div className="space-y-3">
                    {openPositions.map((pos, idx) => {
                    const pnl = pos.unrealized_pnl || 0;
                    const pnlColor = pnl >= 0 ? 'text-emerald-700' : 'text-red-600';
                    const sideColor =
                      pos.side === 'SHORT'
                        ? 'border-red-300 bg-red-50 text-red-700'
                        : 'border-emerald-300 bg-emerald-50 text-emerald-700';

                    // Use EXECUTED entry (not signal entry) for risk calculation
                    const executedEntry = pos.entry_price;
                    const activeSl = pos.stop_loss;
                    const tp1 = pos.signal_tp1 ?? pos.take_profit;
                    const tp2 = pos.signal_tp2;

                    // Calculate risk state
                    const isProfitLocked = pos.side === 'SHORT' ? activeSl <= executedEntry : activeSl >= executedEntry;
                    const riskState = getRiskState(activeSl, executedEntry, isProfitLocked);

                    // Risk status based on executed entry vs active SL
                    let riskStatusLabel: string;
                    if (pos.side === 'SHORT') {
                      if (activeSl > executedEntry) {
                        riskStatusLabel = 'Risk active · Stop loss above entry';
                      } else if (Math.abs(activeSl - executedEntry) < 1e-6) {
                        riskStatusLabel = 'Risk eliminated · Break-even stop';
                      } else {
                        riskStatusLabel = 'Profit protected · Minimum gain locked';
                      }
                    } else {
                      if (activeSl < executedEntry) {
                        riskStatusLabel = 'Risk active · Stop loss below entry';
                      } else if (Math.abs(activeSl - executedEntry) < 1e-6) {
                        riskStatusLabel = 'Risk eliminated · Break-even stop';
                      } else {
                        riskStatusLabel = 'Profit protected · Minimum gain locked';
                      }
                    }

                    return (
                      <div
                        key={idx}
                        className="rounded-xl border border-gray-200 bg-white p-4 text-sm"
                      >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-gray-900 text-base">{pos.ticker}</span>
                            <span
                              className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${sideColor}`}
                            >
                              {pos.side}
                            </span>
                            {/* Optional optimization badge if this position has been partially recycled */}
                            {pos.has_recycled_capital && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 border border-indigo-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
                                Capital recycled (partial)
                              </span>
                            )}
                            {riskState === 'risk' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700 border border-red-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                                Risk Active
                              </span>
                            )}
                            {riskState === 'breakeven' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 border border-amber-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                Break-even
                              </span>
                            )}
                            {riskState === 'locked' && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                                Trailing SL
                              </span>
                            )}
                          </div>
                          <p className={`text-lg font-bold ${pnlColor}`}>
                            {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                          </p>
                        </div>
                        
                        {/* Position details (always shown in New York time) */}
                        <div className="flex items-center gap-4 text-xs text-gray-600 mb-3">
                          <span className="font-mono">{pos.size_shares.toLocaleString()} shares</span>
                          <span>•</span>
                          <span>
                            Entered{' '}
                            {new Date(pos.entry_timestamp).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                              timeZone: TRADING_TZ,
                            })}{' '}
                            at{' '}
                            {new Date(pos.entry_timestamp).toLocaleTimeString('en-US', {
                              hour: '2-digit',
                              minute: '2-digit',
                              timeZone: TRADING_TZ,
                            })}{' '}
                            ET
                          </span>
                        </div>

                        {/* Risk-Reward Bar with spacing */}
                        <div style={{ marginTop: '35px' }}>
                        <RiskRewardBar
                          signalEntryPrice={executedEntry}
                          activeSlPrice={activeSl}
                          tp1Price={tp1}
                          tp2Price={tp2}
                          currentPrice={pos.current_price ?? executedEntry}
                          side={pos.side}
                        />
                        </div>
                      </div>
                    );
                  })}

                  {/* Total P&L Row */}
                  {(() => {
                    const totalPnl = openPositions.reduce((sum, pos) => sum + (pos.unrealized_pnl || 0), 0);
                    const totalPnlR = openPositions.reduce((sum, pos) => sum + (pos.unrealized_pnl_R || 0), 0);
                    const totalPnlColor = totalPnl >= 0 ? 'text-emerald-700' : 'text-red-600';
                    return (
                      <div className="mt-2 flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-semibold">
                        <span>Total Unrealized P&amp;L</span>
                        <div className="flex items-center gap-4">
                          <span className={totalPnlColor}>
                            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                          </span>
                          <span className={totalPnlColor}>{totalPnlR.toFixed(2)}R</span>
                        </div>
                      </div>
                    );
                  })()}

                  </div>
                )}
              </CardContent>
            </Card>
          </ProLockedCard>

        </TabsContent>
      </Tabs>
    </div>
  );
}
