"use client";

import { useState, useEffect } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BacktestModal } from "./BacktestModal";
import { BacktestStats, EquityCurvePoint, BacktestTrade } from "@/lib/backtest/types";
import { BACKTEST_VERSION } from "@/lib/backtest/version";
import { loadPrecomputedBacktest } from "@/lib/backtest/load_precomputed";
import Link from "next/link";
import { Zap, TrendingUp, Target, AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface BacktestCardProps {
  symbol: string;
  isPro: boolean;
}

type TradingStyle = 'DAY' | 'SWING' | 'INVEST';

type HorizonOption = {
  key: string;
  label: string;
  days: number;
};

const HORIZONS: Record<TradingStyle, HorizonOption[]> = {
  DAY: [
    { key: '5D', label: '5 Days', days: 5 },
    { key: '10D', label: '10 Days', days: 10 },
    { key: '30D', label: '30 Days', days: 30 },
  ],
  SWING: [
    { key: '90D', label: '90 Days', days: 90 },
    { key: '180D', label: '180 Days', days: 180 },
    { key: '365D', label: '365 Days', days: 365 },
  ],
  INVEST: [
    { key: '1Y', label: '1 Year', days: 365 },
    { key: '2Y', label: '2 Years', days: 730 },
    { key: '3Y', label: '3 Years', days: 1095 },
  ],
};

export function BacktestCard({ symbol, isPro }: BacktestCardProps) {
  const [tradingStyle, setTradingStyle] = useState<TradingStyle>('SWING');
  const [horizonKey, setHorizonKey] = useState<string>('90D');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [result, setResult] = useState<{
    stats: BacktestStats;
    equityCurve: EquityCurvePoint[];
    trades: BacktestTrade[];
    engineVersion?: string;
    timeframe?: string;
  } | null>(null);
  const selectedHorizon = HORIZONS[tradingStyle].find((option) => option.key === horizonKey) ?? HORIZONS[tradingStyle][0];

  // Reset horizon when trading style changes
  useEffect(() => {
    const defaultHorizon = HORIZONS[tradingStyle][0].key;
    setHorizonKey(defaultHorizon);
    setError(null);
    setResult(null);
  }, [tradingStyle]);

  const handleRunBacktest = async () => {
    // Deprecated in V4.6: live backtest execution replaced by precomputed results.
    setLoading(true);
    setError(null);

    try {
      const styleMap: Record<TradingStyle, "day" | "swing" | "invest"> = {
        DAY: "day",
        SWING: "swing",
        INVEST: "invest",
      };
      const style = styleMap[tradingStyle];
      const data = await loadPrecomputedBacktest(symbol, style);

      if (!data) {
        setError("No backtest results available yet for this ticker.");
        return;
      }

      const statsFull = data.stats ?? {};
      const equityCurveRaw = Array.isArray(statsFull.equity_curve)
        ? statsFull.equity_curve as Array<{ t: number; balance: number }>
        : [];

      const equityCurve: EquityCurvePoint[] = equityCurveRaw.map((p) => ({
        t: new Date(p.t).toISOString(),
        equity: p.balance,
      }));

      const initialEquity = equityCurveRaw[0]?.balance ?? 100000;
      const finalEquity = equityCurveRaw[equityCurveRaw.length - 1]?.balance ?? initialEquity;
      const totalReturnPct = initialEquity > 0 ? ((finalEquity - initialEquity) / initialEquity) * 100 : 0;

      const stats: BacktestStats = {
        profitPct: Number(totalReturnPct.toFixed(2)),
        totalReturn: Number(totalReturnPct.toFixed(2)),
        winRatePct: Number((statsFull.win_rate ?? 0).toFixed(2)),
        winRate: Number((statsFull.win_rate ?? 0).toFixed(2)),
        maxDrawdownPct: Number((statsFull.max_drawdown ?? 0).toFixed(2)),
        maxDrawdown: Number((statsFull.max_drawdown ?? 0).toFixed(2)),
        sharpeRatio: undefined,
        tradesCount: statsFull.trades_total ?? 0,
        totalTrades: statsFull.trades_total ?? 0,
        avgTradeDurationHours: null,
        avgR: Number((statsFull.avg_r ?? 0).toFixed(2)),
        tp1HitRate: undefined,
        tp2HitRate: undefined,
        bestTradeR: statsFull.best_trade_r ?? undefined,
        worstTradeR: statsFull.worst_trade_r ?? undefined,
        bestTrade: undefined,
        worstTrade: undefined,
      };

      const tradesRaw = Array.isArray(data.trades) ? data.trades as any[] : [];
      const trades: BacktestTrade[] = tradesRaw.map((t) => ({
        symbol,
        direction: t.direction === 'short' ? 'SHORT' : 'LONG',
        entryPrice: t.entryPrice ?? t.entry_price ?? 0,
        exitPrice: t.exitPrice ?? t.exit_price ?? 0,
        exitReason: t.exitReason ?? t.exit_reason ?? undefined,
        pnlPct: null,
        openedAt: t.entryTime ?? t.entry_time ?? "",
        closedAt: t.exitTime ?? t.exit_time ?? "",
        durationHours: null,
        confidenceScore: null,
        riskMode: 'medium',
      }));

      setResult({
        stats,
        equityCurve,
        trades,
        engineVersion: `V${BACKTEST_VERSION}`,
        timeframe: data.timeframe_used ?? "",
      });
      setModalOpen(true);
    } catch (err) {
      console.error('Backtest error:', err);
      setError('Unexpected error while loading precomputed backtest.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>AI Backtest (Simulation)</CardTitle>
          <CardDescription>
            See how our AI logic would have traded this symbol historically using a $100,000 model
            portfolio. Simulation only — does not affect live performance.
          </CardDescription>
          <div className="mt-2 text-xs text-muted-foreground">
            This performance uses a precomputed Marild AI simulation (V{BACKTEST_VERSION}).
          </div>
        </CardHeader>
        <CardContent>
          {!isPro ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Backtesting is a PRO feature. Upgrade to run AI simulations on historical data.
              </p>
              <Button asChild>
                <Link href="/upgrade?source=backtest">Upgrade to PRO</Link>
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Trading Style Selector */}
              <div className="space-y-2">
                <span className="text-sm font-medium">Trading Style</span>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant={tradingStyle === 'DAY' ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTradingStyle('DAY')}
                    className="flex items-center gap-2"
                  >
                    <Zap className="h-4 w-4" />
                    Day
                  </Button>
                  <Button
                    variant={tradingStyle === 'SWING' ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTradingStyle('SWING')}
                    className="flex items-center gap-2"
                  >
                    <TrendingUp className="h-4 w-4" />
                    Swing
                  </Button>
                  <Button
                    variant={tradingStyle === 'INVEST' ? "default" : "outline"}
                    size="sm"
                    onClick={() => setTradingStyle('INVEST')}
                    className="flex items-center gap-2"
                  >
                    <Target className="h-4 w-4" />
                    Invest
                  </Button>
                </div>
              </div>
              
              {/* Horizon Selector */}
              <div className="space-y-2">
                <span className="text-sm font-medium">Time Horizon</span>
                <div className="grid grid-cols-3 gap-2">
                  {HORIZONS[tradingStyle].map((option) => (
                    <Button
                      key={option.key}
                      variant={horizonKey === option.key ? "default" : "outline"}
                      size="sm"
                      onClick={() => setHorizonKey(option.key)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
              
              {/* Error Alert */}
              {error && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {/* Run button kept to open modal using precomputed data; label updated */}
              <Button onClick={handleRunBacktest} disabled={loading} className="w-full">
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Loading Backtest...</span>
                  </span>
                ) : (
                  "View Precomputed Backtest"
                )}
              </Button>
              {loading && (
                <div className="text-xs text-muted-foreground space-y-2 mt-3">
                  <div className="flex items-center gap-2">
                    <div className="h-1 w-1 rounded-full bg-primary animate-pulse"></div>
                    <span className="animate-pulse">Calculating indicators (EMA, ATR, volume)</span>
                  </div>
                  <div className="flex items-center gap-2" style={{ animationDelay: "0.5s" }}>
                    <div className="h-1 w-1 rounded-full bg-primary animate-pulse" style={{ animationDelay: "0.5s" }}></div>
                    <span className="animate-pulse" style={{ animationDelay: "0.5s" }}>Identifying trade setups</span>
                  </div>
                  <div className="flex items-center gap-2" style={{ animationDelay: "1s" }}>
                    <div className="h-1 w-1 rounded-full bg-primary animate-pulse" style={{ animationDelay: "1s" }}></div>
                    <span className="animate-pulse" style={{ animationDelay: "1s" }}>Computing equity curve</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <BacktestModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          symbol={symbol}
          horizonDays={selectedHorizon?.days ?? 0}
          stats={result.stats}
          equityCurve={result.equityCurve}
          trades={result.trades}
        />
      )}
    </>
  );
}
