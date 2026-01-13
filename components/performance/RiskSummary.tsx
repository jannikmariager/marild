import { Info } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import clsx from 'clsx';

export interface RiskSummaryData {
  total_market_exposure?: number | null;
  risk_at_stop?: number | null;
  risk_at_stop_pct?: number | null;
}

const EXPOSURE_TOOLTIP =
  'Represents the combined notional value of all currently open AI positions (long and short).\nThis is not the amount invested and not the maximum loss.';

const RISK_HELPER =
  'Maximum theoretical loss based on current open positions if all stop-losses are hit.';

function formatCurrency(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

function formatPercent(value?: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return ` (${value.toFixed(1)}%)`;
}

function riskColorClass(pct?: number | null) {
  if (typeof pct !== 'number' || pct <= 0) return 'text-orange-600';
  if (pct < 2) return 'text-orange-600';
  if (pct <= 4) return 'text-amber-600';
  return 'text-red-600';
}

export function RiskSummary({ summary }: { summary?: RiskSummaryData | null }) {
  const exposureValue = formatCurrency(summary?.total_market_exposure);
  const riskValue = formatCurrency(summary?.risk_at_stop);
  const riskPctText = summary?.risk_at_stop_pct != null ? formatPercent(summary.risk_at_stop_pct) : '';
  const riskClass = riskColorClass(summary?.risk_at_stop_pct);

  return (
    <Card className="shadow-sm border border-gray-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-gray-900">Live Risk Summary</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span>Total Market Exposure</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="w-4 h-4 text-gray-400 cursor-pointer" aria-label="info" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs whitespace-pre-line text-sm">
                  {EXPOSURE_TOOLTIP}
                </TooltipContent>
              </Tooltip>
            </div>
            <div className="text-2xl font-semibold text-gray-900">{exposureValue}</div>
          </div>
          <div className="w-px hidden md:block bg-gray-200" aria-hidden="true" />
          <div className="flex flex-1 flex-col gap-1">
            <div className="text-sm text-gray-600">Risk at Stop</div>
            <div className={clsx('text-2xl font-semibold', riskClass)}>
              {riskValue}
              <span className="text-base font-medium text-gray-500">{riskPctText}</span>
            </div>
            <p className="text-xs text-gray-500">{RISK_HELPER}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
