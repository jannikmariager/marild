'use client';

import { useEffect, useState } from 'react';
import { LightweightOhlcChart } from '@/app/(components)/charts/LightweightOhlcChart';
import { Button } from '@/components/ui/button';

// User-facing timeframes now represent actual candle intervals, like TradingView
// (5m, 15m, 30m, 1h, 4h, 1D, 1W, 1M).
const TIMEFRAMES = ['5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'] as const;
type Timeframe = (typeof TIMEFRAMES)[number];

interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface SymbolChartClientProps {
  symbol: string;
  initialTimeframe?: Timeframe;
  initialCandles?: Candle[];
}

export function SymbolChartClient({ symbol, initialTimeframe = '1D', initialCandles = [] }: SymbolChartClientProps) {
  const [timeframe, setTimeframe] = useState<Timeframe>(initialTimeframe);
  const [candles, setCandles] = useState<Candle[]>(initialCandles);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If we already have initial data for default timeframe, don't refetch immediately
    if (initialCandles.length && timeframe === initialTimeframe) return;
    fetchData(timeframe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe]);

  const fetchData = async (tf: Timeframe) => {
    setLoading(true);
    setError(null);
    try {
      // Symbol comes from route param (e.g. AAPL); use it directly in the path
      const res = await fetch(`/api/markets/${symbol}/ohlc?timeframe=${tf}`);
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        // ignore JSON parse errors for non-JSON responses
      }
      if (!res.ok) {
        const msg = json?.message || json?.error || `Failed to load chart data (status ${res.status})`;
        throw new Error(msg);
      }
      setCandles((json?.candles as Candle[]) || []);
    } catch (e: any) {
      console.error('SymbolChartClient error', e);
      setError(e.message || 'Failed to load chart data');
    } finally {
      setLoading(false);
    }
  };

  const mapped = candles.map((c) => ({
    time: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <div className="inline-flex rounded-full border border-gray-200 bg-white p-0.5 text-xs">
          {TIMEFRAMES.map((tf) => (
            <Button
              key={tf}
              type="button"
              size="sm"
              variant={tf === timeframe ? 'default' : 'ghost'}
              className={`h-7 px-3 text-[11px] rounded-full ${
                tf === timeframe ? 'bg-gray-900 text-white hover:bg-gray-800' : 'text-gray-600'
              }`}
              onClick={() => setTimeframe(tf)}
              disabled={loading && tf === timeframe}
            >
              {tf}
            </Button>
          ))}
        </div>
        {loading && <span className="text-[11px] text-gray-500">Loading…</span>}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-3">
        {error ? (
          <div className="flex flex-col items-center justify-center h-[260px] text-sm text-gray-600">
            <p>{error}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3 h-7 text-xs"
              onClick={() => fetchData(timeframe)}
            >
              Retry
            </Button>
          </div>
        ) : (
          <LightweightOhlcChart data={mapped} height={280} />
        )}
      </div>
    </div>
  );
}
