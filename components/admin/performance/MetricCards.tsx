import React from "react";

type MetricCardsProps = {
  title: string;
  metrics: {
    total_return_pct?: number;
    max_drawdown_pct?: number;
    sharpe?: number;
    win_rate?: number;
    profit_factor?: number;
    trades?: number;
  };
};

function fmtPct(v?: number) {
  if (v === undefined || v === null) return "—";
  return `${(v).toFixed(2)}%`;
}

function fmt(v?: number) {
  if (v === undefined || v === null) return "—";
  return v.toFixed(2);
}

export const MetricCards: React.FC<MetricCardsProps> = ({ title, metrics }) => {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card label="Total Return" value={fmtPct(metrics.total_return_pct)} />
        <Card label="Max DD" value={fmtPct(metrics.max_drawdown_pct)} />
        <Card label="Sharpe" value={fmt(metrics.sharpe)} />
        <Card label="Win Rate" value={fmtPct(metrics.win_rate ? metrics.win_rate * 100 : 0)} />
        <Card label="Profit Factor" value={fmt(metrics.profit_factor)} />
        <Card label="Trades" value={metrics.trades?.toString() ?? "0"} />
      </div>
    </div>
  );
};

const Card: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-gray-200 bg-white p-3">
    <p className="text-xs text-gray-500">{label}</p>
    <p className="text-lg font-semibold text-gray-900">{value}</p>
  </div>
);

export default MetricCards;
