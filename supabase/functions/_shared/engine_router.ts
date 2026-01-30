/**
 * ENGINE ROUTER - Universal routing for all signal modes
 * 
 * Routes tickers to their optimal engine version based on backtested performance.
 * Uses LRU cache with 60-minute TTL for fast lookups.
 * 
 * Supports:
 * - DAYTRADER: Uses signal_engines table (V3, V3_5, V4)
 * - SWING: Uses engine_routing table with timeframe-specific routing (V3, V3_5, V4, V4_1)
 * - INVESTOR: Uses signal_engines_investing table (V3_5, V4, V4_1)
 * 
 * IMPORTANT: No V3 fallback for unknown tickers - returns null if not in routing tables
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

// ============================================================================
// LRU CACHE
// ============================================================================

interface CacheEntry {
  engine_version: 'V3' | 'V3_5' | 'V4' | 'V4_1' | null;
  enabled: boolean;
  timestamp: number;
}

const ENGINE_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes
const MAX_CACHE_SIZE = 100;

function getCachedEngine(ticker: string): CacheEntry | null {
  const entry = ENGINE_CACHE.get(ticker);
  if (!entry) return null;
  
  const age = Date.now() - entry.timestamp;
  if (age > CACHE_TTL_MS) {
    ENGINE_CACHE.delete(ticker);
    return null;
  }
  
  return entry;
}

function setCachedEngine(ticker: string, engine_version: 'V3' | 'V3_5' | 'V4' | 'V4_1' | null, enabled: boolean): void {
  // LRU eviction
  if (ENGINE_CACHE.size >= MAX_CACHE_SIZE) {
    const firstKey = ENGINE_CACHE.keys().next().value;
    if (firstKey) ENGINE_CACHE.delete(firstKey);
  }
  
  ENGINE_CACHE.set(ticker, {
    engine_version,
    enabled,
    timestamp: Date.now(),
  });
}

// ============================================================================
// SUPABASE CLIENT
// ============================================================================

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  return createClient(supabaseUrl, supabaseKey);
}

// ============================================================================
// CORE ROUTING FUNCTIONS
// ============================================================================

export interface EngineRouteResult {
  engine_version: 'V3' | 'V3_5' | 'V4' | 'V4_1';
  enabled: boolean;
  source: 'cache' | 'database';
}

/**
 * Get the optimal DAYTRADER engine version for a ticker.
 * Returns null if ticker is disabled or not in routing table.
 * 
 * Supports V3 (Momentum), V3_5 (Precision), V4 (Liquidity)
 */
export async function getDaytraderEngineForSymbol(ticker: string): Promise<'V3' | 'V3_5' | 'V4' | null> {
  const normalizedTicker = ticker.toUpperCase();
  const cacheKey = `DAYTRADER:${normalizedTicker}`;
  
  // Check cache first
  const cached = getCachedEngine(cacheKey);
  if (cached !== null) {
    console.log(`[engine_router] DAYTRADER ${normalizedTicker} → ${cached.engine_version || 'NOT_SUPPORTED'} (cached)`);
    return cached.enabled && cached.engine_version ? (cached.engine_version as 'V3' | 'V3_5' | 'V4') : null;
  }
  
  // Fetch from database
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('signal_engines')
      .select('engine_version, enabled')
      .eq('ticker', normalizedTicker)
      .eq('engine_type', 'DAYTRADER')
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        // Not found - NOT SUPPORTED (no fallback)
        console.log(`[engine_router] DAYTRADER ${normalizedTicker} → NOT_SUPPORTED (not in routing table)`);
        setCachedEngine(cacheKey, null, false);
        return null;
      }
      throw error;
    }
    
    if (!data.enabled) {
      console.log(`[engine_router] DAYTRADER ${normalizedTicker} → DISABLED`);
      setCachedEngine(cacheKey, data.engine_version as 'V3' | 'V3_5' | 'V4', false);
      return null;
    }
    
    const version = data.engine_version as 'V3' | 'V3_5' | 'V4';
    console.log(`[engine_router] DAYTRADER ${normalizedTicker} → ${version} (database)`);
    setCachedEngine(cacheKey, version, true);
    return version;
    
  } catch (error) {
    console.error(`[engine_router] Error fetching DAYTRADER engine for ${normalizedTicker}:`, error);
    // No fallback - return null on error
    return null;
  }
}

/**
 * Get the optimal SWING engine version for a ticker and timeframe.
 * Returns null if ticker is disabled or not in routing table.
 * 
 * Uses engine_routing table with mode='SWING'
 */
export async function getSwingEngineForSymbol(ticker: string, timeframe: string): Promise<'V3' | 'V3_5' | 'V4' | 'V4_1' | null> {
  const normalizedTicker = ticker.toUpperCase();
  const normalizedTf = timeframe.toLowerCase();
  const cacheKey = `SWING:${normalizedTicker}:${normalizedTf}`;
  
  // Check cache first
  const cached = getCachedEngine(cacheKey);
  if (cached !== null) {
    console.log(`[engine_router] SWING ${normalizedTicker}/${normalizedTf} → ${cached.engine_version || 'NOT_SUPPORTED'} (cached)`);
    return cached.enabled && cached.engine_version ? (cached.engine_version as 'V3' | 'V3_5' | 'V4' | 'V4_1') : null;
  }
  
  // Fetch from database
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('engine_routing')
      .select('engine_version, enabled')
      .eq('ticker', normalizedTicker)
      .eq('mode', 'SWING')
      .eq('timeframe', normalizedTf)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        // Not found - NOT SUPPORTED
        console.log(`[engine_router] SWING ${normalizedTicker}/${normalizedTf} → NOT_SUPPORTED (not in routing table)`);
        setCachedEngine(cacheKey, null, false);
        return null;
      }
      throw error;
    }
    
    if (!data.enabled) {
      console.log(`[engine_router] SWING ${normalizedTicker}/${normalizedTf} → DISABLED`);
      setCachedEngine(cacheKey, data.engine_version as 'V3' | 'V3_5' | 'V4' | 'V4_1', false);
      return null;
    }
    
    const version = data.engine_version as 'V3' | 'V3_5' | 'V4' | 'V4_1';
    console.log(`[engine_router] SWING ${normalizedTicker}/${normalizedTf} → ${version} (database)`);
    setCachedEngine(cacheKey, version, true);
    return version;
    
  } catch (error) {
    console.error(`[engine_router] Error fetching SWING engine for ${normalizedTicker}/${normalizedTf}:`, error);
    return null;
  }
}

/**
 * Get the optimal INVESTOR engine version for a ticker.
 * Returns null if ticker is disabled or not in routing table.
 * 
 * Uses signal_engines_investing table (V3_5, V4, V4_1 only)
 */
export async function getInvestorEngineForSymbol(ticker: string): Promise<'V3_5' | 'V4' | 'V4_1' | null> {
  const normalizedTicker = ticker.toUpperCase();
  const cacheKey = `INVESTOR:${normalizedTicker}`;
  
  // Check cache first
  const cached = getCachedEngine(cacheKey);
  if (cached !== null) {
    console.log(`[engine_router] INVESTOR ${normalizedTicker} → ${cached.engine_version || 'NOT_SUPPORTED'} (cached)`);
    return cached.enabled && cached.engine_version ? (cached.engine_version as 'V3_5' | 'V4' | 'V4_1') : null;
  }
  
  // Fetch from database
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('signal_engines_investing')
      .select('engine_version, enabled')
      .eq('ticker', normalizedTicker)
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        // Not found - NOT SUPPORTED
        console.log(`[engine_router] INVESTOR ${normalizedTicker} → NOT_SUPPORTED (not in routing table)`);
        setCachedEngine(cacheKey, null, false);
        return null;
      }
      throw error;
    }
    
    if (!data.enabled) {
      console.log(`[engine_router] INVESTOR ${normalizedTicker} → DISABLED`);
      setCachedEngine(cacheKey, data.engine_version as 'V3_5' | 'V4' | 'V4_1', false);
      return null;
    }
    
    const version = data.engine_version as 'V3_5' | 'V4' | 'V4_1';
    console.log(`[engine_router] INVESTOR ${normalizedTicker} → ${version} (database)`);
    setCachedEngine(cacheKey, version, true);
    return version;
    
  } catch (error) {
    console.error(`[engine_router] Error fetching INVESTOR engine for ${normalizedTicker}:`, error);
    return null;
  }
}

/**
 * Generic routing function - routes any engine type to appropriate table
 * 
 * @param ticker - Stock symbol
 * @param engineType - DAYTRADER, SWING, or INVESTOR
 * @param timeframe - Required for SWING mode only
 * @returns Engine version or null if not supported
 */
export async function getEngineForSymbol(
  ticker: string,
  engineType: 'DAYTRADER' | 'SWING' | 'INVESTOR',
  timeframe?: string
): Promise<'V3' | 'V3_5' | 'V4' | 'V4_1' | null> {
  if (engineType === 'DAYTRADER') {
    return getDaytraderEngineForSymbol(ticker);
  } else if (engineType === 'SWING') {
    if (!timeframe) {
      throw new Error('Timeframe is required for SWING engine routing');
    }
    return getSwingEngineForSymbol(ticker, timeframe);
  } else if (engineType === 'INVESTOR') {
    return getInvestorEngineForSymbol(ticker);
  }
  
  throw new Error(`Unknown engine type: ${engineType}`);
}

/**
 * Check if a ticker is enabled for DAYTRADER signals.
 */
export async function isTickerEnabled(ticker: string): Promise<boolean> {
  const engine = await getDaytraderEngineForSymbol(ticker);
  return engine !== null;
}

/**
 * Get detailed routing information for a DAYTRADER ticker (for logging/debugging).
 * 
 * @deprecated Use getEngineForSymbol() instead
 */
export async function getEngineRoute(ticker: string): Promise<EngineRouteResult | null> {
  const normalizedTicker = ticker.toUpperCase();
  const cacheKey = `DAYTRADER:${normalizedTicker}`;
  
  // Check cache
  const cached = getCachedEngine(cacheKey);
  if (cached !== null) {
    if (!cached.enabled || !cached.engine_version) return null;
    return {
      engine_version: cached.engine_version as 'V3' | 'V3_5' | 'V4' | 'V4_1',
      enabled: cached.enabled,
      source: 'cache',
    };
  }
  
  // Fetch from database
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('signal_engines')
      .select('engine_version, enabled')
      .eq('ticker', normalizedTicker)
      .eq('engine_type', 'DAYTRADER')
      .single();
    
    if (error) {
      if (error.code === 'PGRST116') {
        // Not found - NOT SUPPORTED
        setCachedEngine(cacheKey, null, false);
        return null;
      }
      throw error;
    }
    
    if (!data.enabled) {
      setCachedEngine(cacheKey, data.engine_version as 'V3' | 'V3_5' | 'V4', false);
      return null;
    }
    
    const version = data.engine_version as 'V3' | 'V3_5' | 'V4';
    setCachedEngine(cacheKey, version, true);
    return { engine_version: version, enabled: true, source: 'database' };
    
  } catch (error) {
    console.error(`[engine_router] Error in getEngineRoute for ${normalizedTicker}:`, error);
    return null;
  }
}

/**
 * Get all enabled tickers for DAYTRADER with their engine versions.
 */
export async function getAllEnabledTickers(): Promise<Array<{ ticker: string; engine_version: 'V3' | 'V3_5' | 'V4' }>> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('signal_engines')
      .select('ticker, engine_version')
      .eq('engine_type', 'DAYTRADER')
      .eq('enabled', true);
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      ticker: row.ticker,
      engine_version: row.engine_version as 'V3' | 'V3_5' | 'V4',
    }));
  } catch (error) {
    console.error('[engine_router] Error fetching all enabled tickers:', error);
    return [];
  }
}

/**
 * Get all enabled tickers for SWING with their engine versions and timeframes.
 */
export async function getAllSwingTickers(): Promise<Array<{ ticker: string; timeframe: string; engine_version: 'V3' | 'V3_5' | 'V4' | 'V4_1' }>> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('engine_routing')
      .select('ticker, timeframe, engine_version')
      .eq('mode', 'SWING')
      .eq('enabled', true);
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      ticker: row.ticker,
      timeframe: row.timeframe,
      engine_version: row.engine_version as 'V3' | 'V3_5' | 'V4' | 'V4_1',
    }));
  } catch (error) {
    console.error('[engine_router] Error fetching all SWING tickers:', error);
    return [];
  }
}

/**
 * Get all enabled tickers for INVESTOR with their engine versions.
 */
export async function getAllInvestorTickers(): Promise<Array<{ ticker: string; engine_version: 'V3_5' | 'V4' | 'V4_1' }>> {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('signal_engines_investing')
      .select('ticker, engine_version')
      .eq('enabled', true);
    
    if (error) throw error;
    
    return (data || []).map(row => ({
      ticker: row.ticker,
      engine_version: row.engine_version as 'V3_5' | 'V4' | 'V4_1',
    }));
  } catch (error) {
    console.error('[engine_router] Error fetching all INVESTOR tickers:', error);
    return [];
  }
}

/**
 * Clear the routing cache (for admin/testing purposes).
 */
export function clearEngineCache(): void {
  ENGINE_CACHE.clear();
  console.log('[engine_router] Cache cleared');
}
