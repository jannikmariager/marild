import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { hasProAccess } from '@/lib/subscription/devOverride';

const DEV_FORCE_PRO = process.env.NEXT_PUBLIC_DEV_FORCE_PRO === 'true';

// Sector ETF symbols for tracking
const SECTOR_ETFS = {
  'Technology': 'XLK',
  'Financials': 'XLF',
  'Healthcare': 'XLV',
  'Energy': 'XLE',
  'Consumer': 'XLY',
  'Industrials': 'XLI',
} as const;

export async function GET() {
  try {
    const supabase = await createClient();

    // Auth + PRO gating (canonical: users.subscription_tier with DEV override)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    let hasAccess = DEV_FORCE_PRO ? true : hasProAccess(false);

    if (!DEV_FORCE_PRO && !hasAccess) {
      if (authError || !user) {
        return NextResponse.json(
          {
            sectors: [],
            updated_at: new Date().toISOString(),
            access: {
              is_locked: true,
              has_pro_access: false,
            },
          },
          { status: 403 }
        );
      }

      const { data: profile, error: userError } = await supabase
        .from('user_profile')
        .select('subscription_tier')
        .eq('user_id', user.id)
        .maybeSingle();

      if (userError) {
        console.error('[Sector Strength API] Failed to load user row for gating:', userError);
      }

      const isPro = profile?.subscription_tier === 'pro';
      hasAccess = hasProAccess(isPro);

      if (!hasAccess) {
        return NextResponse.json(
          {
            sectors: [],
            updated_at: new Date().toISOString(),
            access: {
              is_locked: true,
              has_pro_access: false,
            },
          },
          { status: 403 }
        );
      }
    }

    // Fetch sector ETF performance from market_quotes
    const symbols = Object.values(SECTOR_ETFS);
    
    const { data: quotes, error: quotesError } = await supabase
      .from('market_quotes')
      .select('symbol, change_percent, updated_at')
      .in('symbol', symbols);

    if (quotesError) {
      console.error('[Sector Strength API] Error fetching quotes:', quotesError);
    }

    // Map ETF data back to sector names
    const sectorMap = new Map<string, number>();
    let latestUpdate = new Date().toISOString();

    if (quotes && quotes.length > 0) {
      quotes.forEach((quote) => {
        const sectorName = Object.keys(SECTOR_ETFS).find(
          (key) => SECTOR_ETFS[key as keyof typeof SECTOR_ETFS] === quote.symbol
        );
        if (sectorName) {
          sectorMap.set(sectorName, quote.change_percent || 0);
        }
        if (quote.updated_at) {
          latestUpdate = quote.updated_at;
        }
      });
    }

    // Build sector array from real data only
    const sectors = Object.keys(SECTOR_ETFS).map((name) => ({
      name,
      change: sectorMap.get(name) || 0,
    }));

    // If no real data, handle gracefully
    if (!quotes || quotes.length === 0) {
      console.error('[Sector Strength API] No market_quotes data available');

      // In DEV with PRO override, return placeholder data instead of a 5xx
      if (DEV_FORCE_PRO) {
        const sectors = Object.keys(SECTOR_ETFS).map((name) => ({
          name,
          change: 0,
        }));

        return NextResponse.json({
          sectors,
          updated_at: new Date().toISOString(),
          access: {
            is_locked: false,
            has_pro_access: true,
          },
        });
      }

      return NextResponse.json(
        {
          error: 'NO_DATA',
          message: 'Sector data not available right now',
          sectors: [],
          updated_at: new Date().toISOString(),
          access: {
            is_locked: false,
            has_pro_access: DEV_FORCE_PRO,
          },
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      sectors,
      updated_at: latestUpdate,
      access: {
        is_locked: false,
        has_pro_access: true,
      },
    });
  } catch (error: any) {
    console.error('[Sector Strength API] Error:', error);
    return NextResponse.json(
      {
        sectors: [],
        updated_at: new Date().toISOString(),
        access: {
          is_locked: false,
          has_pro_access: false,
        },
        error: error.message,
      },
      { status: 500 }
    );
  }
}
