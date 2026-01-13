export type SubscriptionTier = 'free' | 'pro' | 'expired';

export interface User {
  id: string;
  email: string;
  subscription_tier: SubscriptionTier;
  // Derived from Supabase auth.users.email_confirmed_at
  email_verified?: boolean;
  country?: string;
  preferred_markets?: string[];
  risk_level?: number;
  created_at?: string;
  updated_at?: string;
}

export interface WatchlistItem {
  id: string;
  user_id: string;
  symbol: string;
  name: string;
  added_at: string;
}

export interface NewsItem {
  id: string;
  symbol?: string;
  title: string;
  source: string;
  url: string;
  published_at: string;
  sentiment?: 'bullish' | 'neutral' | 'bearish';
  summary?: string;
}

export interface MarketData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  marketCap?: number;
  exchange?: string;
}

export interface SystemAlert {
  id: string;
  type: 'info' | 'warning' | 'error';
  message: string;
  created_at: string;
  resolved: boolean;
}
