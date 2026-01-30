/**
 * Data Provider Cost Logger
 * Centralized utility for logging external API usage and costs to data_source_costs table
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Estimated cost per API request (in USD)
// These are rough estimates - adjust based on actual pricing tiers
export const DATA_PROVIDER_COSTS = {
  // Market Data Providers
  'polygon.io': 0.002,        // ~$0.002 per request (depends on plan)
  'finnhub': 0.001,           // ~$0.001 per request  
  'yahoo_finance': 0.0,       // Free
  'alpha_vantage': 0.0,       // Free tier
  
  // News/Sentiment Providers
  'newsdata.io': 0.01,        // ~$0.01 per request (depends on plan)
  'newsapi': 0.005,           // ~$0.005 per request
  
  // Crypto Data Providers
  'coingecko': 0.001,         // ~$0.001 per request
  'coinmarketcap': 0.002,     // ~$0.002 per request
  
  // Other
  'system': 0.0,              // Internal/system calls
} as const;

export type DataProvider = keyof typeof DATA_PROVIDER_COSTS;

export interface LogDataCostParams {
  provider: DataProvider;
  requestCount?: number; // Default: 1
  period?: string;       // Default: 'instant'
}

/**
 * Log data provider usage to data_source_costs table
 */
export async function logDataCost(params: LogDataCostParams): Promise<void> {
  const { provider, requestCount = 1, period = 'instant' } = params;
  
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    const costPerRequest = DATA_PROVIDER_COSTS[provider] ?? 0;
    const totalCost = costPerRequest * requestCount;
    
    const { error } = await supabase.from('data_source_costs').insert({
      provider_name: provider,
      request_count: requestCount,
      cost_usd: totalCost,
      period,
      timestamp: new Date().toISOString(),
    });
    
    if (error) {
      console.error('[data_cost_logger] Failed to log cost:', error);
    } else if (totalCost > 0) {
      console.log(`[data_cost_logger] Logged: ${provider} | ${requestCount} req | $${totalCost.toFixed(4)}`);
    }
  } catch (err) {
    console.error('[data_cost_logger] Unexpected error:', err);
  }
}

/**
 * Batch log multiple provider costs at once
 * Useful for functions that call multiple providers in a single request
 */
export async function logDataCostBatch(
  entries: Array<{ provider: DataProvider; requestCount?: number }>
): Promise<void> {
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    const records = entries.map(({ provider, requestCount = 1 }) => {
      const costPerRequest = DATA_PROVIDER_COSTS[provider] ?? 0;
      const totalCost = costPerRequest * requestCount;
      
      return {
        provider_name: provider,
        request_count: requestCount,
        cost_usd: totalCost,
        period: 'instant',
        timestamp: new Date().toISOString(),
      };
    });
    
    const { error } = await supabase.from('data_source_costs').insert(records);
    
    if (error) {
      console.error('[data_cost_logger] Failed to batch log costs:', error);
    } else {
      const totalCost = records.reduce((sum, r) => sum + r.cost_usd, 0);
      const totalRequests = records.reduce((sum, r) => sum + r.request_count, 0);
      console.log(`[data_cost_logger] Batch logged: ${entries.length} providers | ${totalRequests} req | $${totalCost.toFixed(4)}`);
    }
  } catch (err) {
    console.error('[data_cost_logger] Unexpected error in batch:', err);
  }
}

/**
 * Helper to wrap a data provider call with automatic cost logging
 * 
 * Example:
 * const data = await trackDataProviderCall('polygon.io', async () => {
 *   return await fetchFromPolygon(ticker);
 * });
 */
export async function trackDataProviderCall<T>(
  provider: DataProvider,
  fn: () => Promise<T>
): Promise<T> {
  const result = await fn();
  
  // Log after successful call
  await logDataCost({ provider });
  
  return result;
}
