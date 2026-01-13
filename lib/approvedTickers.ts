import { createClient } from '@supabase/supabase-js';
import { unstable_cache } from 'next/cache';

/**
 * Load approved tickers from the approved_tickers_view
 * Uses service role key to bypass RLS
 * Cached for 1 hour to reduce database load
 */
async function loadApprovedTickersInternal(): Promise<string[]> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[approvedTickers] Missing Supabase environment variables');
    // Fail safe: return empty array (deny all) if config is broken
    return [];
  }

  // Use service role key for backend operations (bypasses RLS)
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Query the view which unions all three engine tables
    const { data, error } = await supabase
      .from('approved_tickers_view')
      .select('ticker');

    if (error) {
      console.error('[approvedTickers] Database error:', error);
      // Fail safe: return empty array on error
      return [];
    }

    if (!data || data.length === 0) {
      console.warn('[approvedTickers] No approved tickers found in database');
      return [];
    }

    // Extract and normalize ticker symbols
    const tickers = data.map((row) => row.ticker.toUpperCase());
    
    console.log(`[approvedTickers] Loaded ${tickers.length} approved tickers`);
    
    return tickers;
  } catch (error) {
    console.error('[approvedTickers] Unexpected error:', error);
    // Fail safe: return empty array on unexpected errors
    return [];
  }
}

/**
 * Get approved tickers with 1-hour cache
 * This reduces database load for frequently accessed pages
 */
export const loadApprovedTickers = unstable_cache(
  loadApprovedTickersInternal,
  ['approved-tickers'],
  {
    revalidate: 3600, // Cache for 1 hour
    tags: ['approved-tickers'],
  }
);

/**
 * Check if a specific ticker is approved
 * Convenience helper for single-ticker validation
 */
export async function isTickerApproved(symbol: string): Promise<boolean> {
  const approved = await loadApprovedTickers();
  return approved.includes(symbol.toUpperCase());
}
