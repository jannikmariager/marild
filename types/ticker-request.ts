export interface TickerRequest {
  id: string;
  ticker: string;
  request_count: number;
  first_requested_at: string;
  last_requested_at: string;
  last_user_id: string | null;
  last_platform: string;
  last_source: 'search_empty' | 'watchlist_block';
  last_context: Record<string, any>;
  status: 'pending' | 'reviewed' | 'approved' | 'rejected';
  notes: string | null;
}

export type TickerRequestSource = 'search_empty' | 'watchlist_block';

export type TickerRequestMode = 'DAYTRADER' | 'SWING' | 'INVESTING' | 'mixed';
