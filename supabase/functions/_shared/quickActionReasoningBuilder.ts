// Helper functions to build metrics and reasons arrays from market data
// This provides structured "Why this was detected" transparency

import type { QuickActionMetric, QuickActionReasonLine } from "./quickActionTypes.ts";

/**
 * Build metrics array from signal data
 */
export function buildSignalMetrics(signal: any): QuickActionMetric[] {
  const metrics: QuickActionMetric[] = [];

  if (signal.confidence != null) {
    metrics.push({
      label: "Confidence",
      value: `${Math.round(signal.confidence * 100)}%`,
      hint: "AI confidence score for this signal",
    });
  }

  if (signal.current_price != null) {
    metrics.push({
      label: "Price",
      value: `$${signal.current_price.toFixed(2)}`,
    });
  }

  if (signal.changePercent != null) {
    const change = signal.changePercent.toFixed(2);
    metrics.push({
      label: "Change",
      value: `${change > 0 ? '+' : ''}${change}%`,
      hint: "Price change from previous close",
    });
  }

  return metrics;
}

/**
 * Build reasons array for bullish signals
 */
export function buildBullishReasons(signal: any): QuickActionReasonLine[] {
  const reasons: QuickActionReasonLine[] = [];

  if (signal.signal_type?.includes('BUY') || signal.signal_type?.includes('BULLISH')) {
    reasons.push({
      label: "Bullish signal detected",
      detail: `${signal.signal_type} pattern identified with ${Math.round((signal.confidence || 0.7) * 100)}% confidence`,
    });
  }

  if (signal.changePercent > 2) {
    reasons.push({
      label: "Strong momentum",
      detail: `Price up ${signal.changePercent.toFixed(1)}% showing bullish momentum`,
    });
  }

  if (signal.confidence > 0.7) {
    reasons.push({
      label: "High confidence",
      detail: "Multiple technical indicators align bullishly",
    });
  }

  return reasons;
}

/**
 * Build reasons array for bearish signals
 */
export function buildBearishReasons(signal: any): QuickActionReasonLine[] {
  const reasons: QuickActionReasonLine[] = [];

  if (signal.signal_type?.includes('SELL') || signal.signal_type?.includes('BEARISH')) {
    reasons.push({
      label: "Bearish signal detected",
      detail: `${signal.signal_type} pattern identified with ${Math.round((signal.confidence || 0.7) * 100)}% confidence`,
    });
  }

  if (signal.changePercent < -2) {
    reasons.push({
      label: "Downward pressure",
      detail: `Price down ${Math.abs(signal.changePercent).toFixed(1)}% showing bearish momentum`,
    });
  }

  if (signal.confidence > 0.7) {
    reasons.push({
      label: "High confidence",
      detail: "Multiple technical indicators align bearishly",
    });
  }

  return reasons;
}

/**
 * Build metrics from market/sector data
 */
export function buildMarketMetrics(data: any): QuickActionMetric[] {
  const metrics: QuickActionMetric[] = [];

  if (data.performance_pct != null) {
    const perf = data.performance_pct.toFixed(2);
    metrics.push({
      label: "Performance",
      value: `${perf > 0 ? '+' : ''}${perf}%`,
    });
  }

  if (data.trend) {
    metrics.push({
      label: "Trend",
      value: data.trend.charAt(0).toUpperCase() + data.trend.slice(1),
    });
  }

  return metrics;
}

/**
 * Build generic reasons from any context
 */
export function buildGenericReasons(context: {
  primary_reason: string;
  secondary_reason?: string;
  confidence?: number;
}): QuickActionReasonLine[] {
  const reasons: QuickActionReasonLine[] = [];

  if (context.primary_reason) {
    reasons.push({
      label: "Primary factor",
      detail: context.primary_reason,
    });
  }

  if (context.secondary_reason) {
    reasons.push({
      label: "Supporting evidence",
      detail: context.secondary_reason,
    });
  }

  if (context.confidence && context.confidence > 0.75) {
    reasons.push({
      label: "High confidence",
      detail: `Analysis shows ${Math.round(context.confidence * 100)}% confidence based on multiple factors`,
    });
  }

  return reasons;
}
