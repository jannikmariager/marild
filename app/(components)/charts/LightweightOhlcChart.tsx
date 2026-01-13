'use client';

import { useEffect, useRef, useState } from 'react';
import type { IChartApi, ISeriesApi, CandlestickData } from 'lightweight-charts';

export interface LightweightOhlcChartProps {
  data: { time: number | string; open: number; high: number; low: number; close: number }[];
  height?: number;
}

export function LightweightOhlcChart({ data, height = 340 }: LightweightOhlcChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    let destroyed = false;

    (async () => {
      try {
        const { createChart, CandlestickSeries } = await import('lightweight-charts');
        if (!containerRef.current || destroyed) return;

        const chart = createChart(containerRef.current, {
          width: containerRef.current.clientWidth,
          layout: {
            background: { color: 'transparent' },
            textColor: '#0f172a',
          },
          grid: {
            vertLines: { color: '#e5e7eb' },
            horzLines: { color: '#e5e7eb' },
          },
          crosshair: {
            mode: 1 as any,
          },
          rightPriceScale: {
            borderColor: '#e5e7eb',
          },
          timeScale: {
            borderColor: '#e5e7eb',
          },
          height,
        });

        // In v5, use addSeries with the series type
        const series = chart.addSeries(CandlestickSeries, {
          upColor: '#16a34a',
          borderUpColor: '#16a34a',
          wickUpColor: '#16a34a',
          downColor: '#ef4444',
          borderDownColor: '#ef4444',
          wickDownColor: '#ef4444',
        });

        chartRef.current = chart;
        seriesRef.current = series;

        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            const { width, height: h } = entry.contentRect;
            chart.applyOptions({ width, height: h });
          }
        });

        observer.observe(containerRef.current!);

        return () => {
          destroyed = true;
          observer.disconnect();
          chart.remove();
          chartRef.current = null;
          seriesRef.current = null;
        };
      } catch (error) {
        console.error('[LightweightOhlcChart] Failed to load chart:', error);
        setError('Failed to initialize chart');
      }
    })();

    return () => {
      destroyed = true;
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current) return;

    const mapped = data.map((c) => ({
      time: typeof c.time === 'number' ? (c.time as number) : (c.time as string),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    })) as CandlestickData[];

    seriesRef.current.setData(mapped);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  if (error) {
    return (
      <div className="w-full h-[340px] flex items-center justify-center text-sm text-gray-500">
        {error}
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-[340px]" />;
}
