"use client";

import { useEffect, useState } from "react";
import EquityCurveChart from "@/components/admin/performance/EquityCurveChart";
import MetricCards from "@/components/admin/performance/MetricCards";

type CurvePoint = { ts: string; equity: number };
type Metrics = Record<string, any>;

type ApiResponse = {
  crypto: { equity_curve: CurvePoint[]; metrics: Metrics };
  stocks: { equity_curve: CurvePoint[]; metrics: Metrics };
  correlation: number;
};

export default function PerformanceComparePage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/performance/compare")
      .then((r) => r.json())
      .then((json) => {
        if (json.error) {
          setError(json.error);
        } else {
          setData(json);
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6">Loading…</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>;
  if (!data) return <div className="p-6">No data</div>;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Crypto vs Stocks Performance</h1>
        <p className="text-sm text-gray-600">
          Shadow-only crypto engine (CRYPTO_V1_SHADOW) compared against stock portfolios.
        </p>
        <p className="text-xs text-gray-500">Correlation (daily returns): {data.correlation.toFixed(3)}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <EquityCurveChart title="Crypto Shadow Equity" points={data.crypto.equity_curve} />
        <EquityCurveChart title="Stocks Equity" points={data.stocks.equity_curve} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCards title="Crypto Shadow Metrics" metrics={data.crypto.metrics} />
        <MetricCards title="Stocks Metrics" metrics={data.stocks.metrics} />
      </div>
    </div>
  );
}
