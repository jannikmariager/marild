// Edge Function: sector_strength_overview
// Returns sector performance snapshot (6 sectors)
// PRO gating with DEV_FORCE_PRO override
// 30-minute caching

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  getUserSubscriptionStatus,
  hasProAccess,
} from '../_shared/subscription_checker.ts';
import { fetchBulkQuotes } from '../_shared/yahoo_v8_client.ts';

interface Sector {
  name: string;
  symbol: string;
  performance_1d: number;
  trend: 'up' | 'down' | 'neutral';
  icon: string;
  isLocked?: boolean; // For free users on sectors 4-6
}

const CACHE_KEY = 'sector_strength_overview';
const CACHE_TTL_MINUTES = 30;

// Define sectors
const SECTORS = [
  { name: 'Technology', symbol: 'XLK', icon: 'cpu' },
  { name: 'Financials', symbol: 'XLF', icon: 'dollarSign' },
  { name: 'Healthcare', symbol: 'XLV', icon: 'heart' },
  { name: 'Energy', symbol: 'XLE', icon: 'zap' },
  { name: 'Consumer', symbol: 'XLY', icon: 'shoppingCart' },
  { name: 'Industrials', symbol: 'XLI', icon: 'factory' },
];

// Fetch live sector performance from Yahoo Finance v8
async function fetchLiveSectorPerformance(): Promise<Sector[]> {
  console.log('[SectorStrength] Fetching live data from Yahoo v8...');
  
  const symbols = SECTORS.map(s => s.symbol);
  const quotes = await fetchBulkQuotes(symbols);
  
  const sectors = SECTORS.map((sector) => {
    const quote = quotes[sector.symbol];
    
    if (!quote || quote.changePercent === null) {
      throw new Error(`Missing data for ${sector.symbol}`);
    }
    
    const performance = quote.changePercent;
    
    // Determine trend
    let trend: 'up' | 'down' | 'neutral';
    if (performance > 0.5) {
      trend = 'up';
    } else if (performance < -0.5) {
      trend = 'down';
    } else {
      trend = 'neutral';
    }
    
    return {
      name: sector.name,
      symbol: sector.symbol,
      performance_1d: Math.round(performance * 100) / 100,
      trend,
      icon: sector.icon,
    };
  });
  
  console.log(`[SectorStrength] Live data fetched successfully`);
  return sectors;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Extract JWT from Authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    const token = authHeader.replace('Bearer ', '');

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from JWT
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired token' }),
        {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Check subscription status
    const subscriptionStatus = await getUserSubscriptionStatus(
      supabase,
      user.id
    );
    const isPro = hasProAccess(subscriptionStatus);

    // Check cache first
    const { data: cachedData } = await supabase
      .from('ai_cache')
      .select('data, updated_at')
      .eq('cache_key', CACHE_KEY)
      .single();

    if (cachedData) {
      const cacheAge = Date.now() - new Date(cachedData.updated_at).getTime();
      const cacheAgeMinutes = cacheAge / (1000 * 60);

      if (cacheAgeMinutes < CACHE_TTL_MINUTES) {
        return new Response(
          JSON.stringify({
            ...cachedData.data,
            cached: true,
            cache_age_minutes: Math.round(cacheAgeMinutes),
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          }
        );
      }
    }

    // Fetch live sector data
    let allSectors: Sector[];
    let isLive = false;
    
    try {
      allSectors = await fetchLiveSectorPerformance();
      isLive = true;
    } catch (error) {
      console.error('[SectorStrength] Failed to fetch live data:', error.message);
      // Return error response instead of mock data
      return new Response(
        JSON.stringify({
          error: 'NO_DATA',
          message: 'Sector data not available right now',
          access: { is_locked: !isPro },
        }),
        {
          status: 503,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }
    
    // Apply PRO gating
    let sectors: Sector[];
    if (isPro) {
      // PRO: all 6 sectors
      sectors = allSectors;
    } else {
      // Free: first 3 sectors visible, last 3 locked
      sectors = allSectors.map((sector, index) => {
        if (index < 3) {
          return sector; // First 3 visible
        } else {
          return {
            ...sector,
            performance_1d: 0, // Hide actual data
            trend: 'neutral' as const,
            isLocked: true,
          };
        }
      });
    }

    const response = {
      sectors,
      access: {
        is_locked: !isPro,
      },
      count: sectors.length,
      updated_at: new Date().toISOString(),
      isLive: true,
    };

    // Store in cache
    await supabase.from('ai_cache').upsert(
      {
        cache_key: CACHE_KEY,
        data: response,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'cache_key' }
    );

    return new Response(
      JSON.stringify({
        ...response,
        cached: false,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in sector_strength_overview:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
