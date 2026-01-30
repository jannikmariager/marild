// Shared types for Quick AI Actions
// Used by both Flutter and Next.js clients

export type QuickActionId =
  | "analyze-watchlist"
  | "find-bullish-setups"
  | "scan-breakouts"
  | "check-sector-rotation"
  | "review-portfolio-risk"
  | "find-bearish-setups"
  | "upcoming-earnings"
  | "find-oversold-stocks"
  | "find-overbought-stocks"        // NEW
  | "detect-trend-reversals"        // NEW
  | "volatility-risk-regime"        // NEW
  | "macro-briefing"                // NEW
  | "find-momentum-leaders"         // NEW
  | "high-short-interest"           // NEW
  | "analyze-market-sentiment";     // NEW - 14th action for perfect 2x7 grid

export interface QuickActionRequest {
  action: QuickActionId;
  symbols?: string[]; // optional: override / limit to specific symbols
  timeframe?: "intraday" | "swing" | "position"; // optional preference
}

export interface QuickActionMetric {
  label: string; // e.g. "Trend"
  value: string; // e.g. "Strong uptrend"
  hint?: string; // small extra explanation
}

export interface QuickActionReasonLine {
  label: string; // Short label: "RSI overbought", "Price extended"
  detail: string; // Longer explanation
}

export interface QuickActionInsight {
  id: string; // stable ID (e.g. symbol or symbol+action)
  title: string; // heading
  subtitle?: string; // secondary line
  body: string; // detailed explanation
  severity?: "info" | "opportunity" | "risk" | "warning";
  tags?: string[]; // e.g. ["AAPL", "Tech", "Bullish"]
  metrics?: QuickActionMetric[];
  reasons?: QuickActionReasonLine[]; // Why this was detected
  
  // NEW: Optional user actions
  userActions?: {
    canAddToWatchlist?: boolean;
    canRequestTradeSignal?: boolean;
    canOpenChart?: boolean;
    canMarkRead?: boolean;
  };
}

export interface QuickActionResult {
  action: QuickActionId;
  generatedAt: string; // ISO datetime
  headline: string; // overview sentence
  summary: string; // slightly longer overview paragraph
  insights: QuickActionInsight[];
  disclaimer: string; // "Not financial advice" etc.
}
