import React from "react";

type Point = { ts: string; equity: number };

interface Props {
  title: string;
  points: Point[];
}

export const EquityCurveChart: React.FC<Props> = ({ title, points }) => {
  const last = points.slice(-10).reverse();
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {points.length === 0 ? (
        <p className="text-xs text-gray-500">No data</p>
      ) : (
        <div className="max-h-48 overflow-auto text-xs">
          <table className="min-w-full text-left">
            <thead>
              <tr className="text-gray-500">
                <th className="px-2 py-1">TS (UTC)</th>
                <th className="px-2 py-1">Equity</th>
              </tr>
            </thead>
            <tbody>
              {last.map((p) => (
                <tr key={p.ts} className="border-t">
                  <td className="px-2 py-1">{p.ts}</td>
                  <td className="px-2 py-1">{p.equity.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default EquityCurveChart;
