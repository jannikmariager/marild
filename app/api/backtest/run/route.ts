/**
 * New Backtest API Route - /api/backtest/run
 * Runs AI backtests with engine routing, approval checks, and PRO gating
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabaseServer';
import { hasProAccess } from '@/lib/subscription/devOverride';
import { z } from 'zod';
import { backtestV3 } from '@/lib/backtest/backtest_v3';
import { backtestV3_5 } from '@/lib/backtest/backtest_v3_5';
import { backtestV4 } from '@/lib/backtest/backtest_v4';
import { backtestV4_1 } from '@/lib/backtest/backtest_v4_1';
import type { OHLCBar } from '@/lib/backtest/shared_types';

// ============================================================
// TYPES & VALIDATION
// ============================================================

type TradingStyle = 'DAY' | 'SWING' | 'INVEST';
type EngineType = 'DAYTRADER' | 'SWING' | 'INVESTOR';

const requestSchema = z.object({
  symbol: z.string().min(1).max(10),
  tradingStyle: z.enum(['DAY', 'SWING', 'INVEST']),
  horizonKey: z.string(),
});

const styleConfig = {
  DAY: {
    engineType: 'DAYTRADER' as const,
    defaultTimeframe: '5m' as const,
    horizons: {
      '5D': 5,
      '10D': 10,
      '30D': 30,
    },
  },
  SWING: {
    engineType: 'SWING' as const,
    defaultTimeframe: '4H' as const, // Will fetch 1H and aggregate
    horizons: {
      '90D': 90,
      '180D': 180,
      '365D': 365,
    },
  },
  INVEST: {
    engineType: 'INVESTOR' as const,
    defaultTimeframe: '1D' as const,
    horizons: {
      '1Y': 365,
      '2Y': 730,
      '3Y': 1095,
    },
  },
} as const;

// ============================================================
// HELPER FUNCTIONS
// ============================================================

/**
 * Check if ticker is approved for the given engine type
 */
async function checkTickerApproval(
  supabase: any,
  symbol: string,
  engineType: EngineType
): Promise<boolean> {
  let query;
  
  switch (engineType) {
    case 'DAYTRADER':
      query = supabase
        .from('signal_engines')
        .select('enabled')
        .eq('ticker', symbol)
        .eq('engine_type', 'DAYTRADER')
        .eq('enabled', true)
        .limit(1);
      break;
      
    case 'SWING':
      query = supabase
        .from('engine_routing')
        .select('enabled')
        .eq('ticker', symbol)
        .eq('mode', 'SWING')
        .eq('enabled', true)
        .limit(1);
      break;
      
    case 'INVESTOR':
      query = supabase
        .from('signal_engines_investing')
        .select('enabled')
        .eq('ticker', symbol)
        .eq('enabled', true)
        .limit(1);
      break;
  }
  
  const { data, error } = await query;
  
  if (error) {
    console.error('[checkTickerApproval] Error:', error);
    return false;
  }
  
  // Approved if ANY row exists with enabled=true
  return Array.isArray(data) && data.length > 0;
}

// ============================================================
// MAIN HANDLER
// ============================================================

export async function POST(request: NextRequest) {
  try {
    // 1. Parse and validate request
    const body = await request.json();
    const { symbol: rawSymbol, tradingStyle, horizonKey } = requestSchema.parse(body);
    const symbol = rawSymbol.toUpperCase();
    
    // 2. Get style configuration
    const config = styleConfig[tradingStyle];
    if (!config) {
      return NextResponse.json(
        { errorCode: 'INVALID_STYLE', message: 'Invalid trading style' },
        { status: 400 }
      );
    }
    
    // 3. Validate horizon
    const horizonDays = config.horizons[horizonKey as keyof typeof config.horizons];
    if (!horizonDays) {
      return NextResponse.json(
        { errorCode: 'INVALID_HORIZON', message: 'Invalid horizon for this trading style' },
        { status: 400 }
      );
    }
    
    const { engineType, defaultTimeframe } = config;
    
    // 4. Auth check
    const supabase = await createClient();
    const { data: { user: authUser }, error: sessionError } = await supabase.auth.getUser();
    
    if (sessionError || !authUser) {
      return NextResponse.json(
        { errorCode: 'UNAUTHORIZED', message: 'Authentication required' },
        { status: 401 }
      );
    }
    
    // 5. Get user profile and check PRO access
    const { data: user, error: userError } = await supabase
      .from('user_profile')
      .select('subscription_tier')
      .eq('user_id', authUser.id)
      .single();
    
    if (userError || !user) {
      return NextResponse.json(
        { errorCode: 'USER_NOT_FOUND', message: 'User profile not found' },
        { status: 404 }
      );
    }
    
    const hasPro = hasProAccess(user.subscription_tier === 'pro');
    if (!hasPro) {
      return NextResponse.json(
        { errorCode: 'PRO_REQUIRED', message: 'PRO subscription required for AI backtesting' },
        { status: 403 }
      );
    }
    
    // 6. Check ticker approval
    const isApproved = await checkTickerApproval(supabase, symbol, engineType);
    console.log(`[backtest/run] Ticker approval check: ${symbol} ${engineType} → ${isApproved}`);
    
    if (!isApproved) {
      console.error(`[backtest/run] REJECTED: ${symbol} not approved for ${engineType}`);
      return NextResponse.json(
        {
          errorCode: 'UNAPPROVED_TICKER',
          message: 'This symbol is not approved for AI backtesting in this trading style',
        },
        { status: 400 }
      );
    }
    
    // 7. Get engine version via Edge Function
    const { data: engineData, error: engineError } = await supabase.functions.invoke(
      'get_backtest_engine',
      {
        body: {
          symbol,
          engineType,
          timeframe: defaultTimeframe,
        },
      }
    );
    
    console.log('[backtest/run] Edge Function response:', { engineData, engineError });
    
    if (engineError || !engineData?.engineVersion) {
      console.error('[backtest/run] Engine routing failed:', engineError);
      console.error('[backtest/run] Engine data received:', engineData);
      return NextResponse.json(
        {
          errorCode: 'UNAPPROVED_TICKER',
          message: 'This symbol is not approved for AI backtesting in this trading style',
        },
        { status: 400 }
      );
    }
    
    const engineVersion = engineData.engineVersion as 'V3' | 'V3_5' | 'V4' | 'V4_1';
    
    // 8. Fetch OHLC data via Edge Function
    const { data: ohlcData, error: ohlcError } = await supabase.functions.invoke(
      'fetch_backtest_ohlc',
      {
        body: {
          symbol,
          timeframe: defaultTimeframe,
          engineType,
          horizonDays,
        },
      }
    );
    
    if (ohlcError || !ohlcData?.candles || ohlcData.candles.length < 50) {
      console.error('[backtest/run] OHLC fetch failed:', ohlcError);
      
      if (ohlcData?.candles && ohlcData.candles.length < 50) {
        return NextResponse.json(
          {
            errorCode: 'INSUFFICIENT_DATA',
            message: 'Not enough historical data to run a meaningful backtest for this symbol and horizon',
          },
          { status: 400 }
        );
      }
      
      return NextResponse.json(
        {
          errorCode: 'DATA_UNAVAILABLE',
          message: 'We were unable to fetch recent price data for this symbol. Please try again shortly',
        },
        { status: 500 }
      );
    }
    
    const ohlc: OHLCBar[] = ohlcData.candles;
    
    // 9. Run backtest with appropriate engine
    console.log(`[backtest/run] Running ${engineVersion} backtest for ${symbol} (${engineType}, ${horizonDays} days, ${ohlc.length} bars)`);
    
    let result;
    const params = {
      symbol,
      engineType,
      engineVersion,
      timeframe: defaultTimeframe,
      ohlc,
      initialBalance: 100000,
      horizonDays,
    };
    
    switch (engineVersion) {
      case 'V3':
        result = await backtestV3(params);
        break;
      case 'V3_5':
        result = await backtestV3_5(params);
        break;
      case 'V4':
        result = await backtestV4(params);
        break;
      case 'V4_1':
        result = await backtestV4_1(params);
        break;
      default:
        return NextResponse.json(
          {
            errorCode: 'BACKTEST_FAILED',
            message: `Unsupported engine version: ${engineVersion}`,
          },
          { status: 500 }
        );
    }
    
    // 10. Return results
    console.log(`[backtest/run] ✅ Complete: ${result.trades.length} trades, ${result.stats.totalReturnPct}% return, ${result.stats.winRatePct}% win rate`);
    
    const startDate = ohlc[0]?.timestamp ? new Date(ohlc[0].timestamp).toISOString() : null;
    const endDate = ohlc[ohlc.length - 1]?.timestamp ? new Date(ohlc[ohlc.length - 1].timestamp).toISOString() : null;
    
    return NextResponse.json({
      symbol,
      tradingStyle,
      engineType,
      engineVersion,
      timeframe: defaultTimeframe,
      horizonKey,
      horizonDays,
      startDate,
      endDate,
      stats: result.stats,
      equityCurve: result.equityCurve,
      trades: result.trades,
    });
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { errorCode: 'INVALID_REQUEST', message: 'Invalid request data', errors: error.issues },
        { status: 400 }
      );
    }
    
    console.error('[backtest/run] Unexpected error:', error);
    return NextResponse.json(
      {
        errorCode: 'BACKTEST_FAILED',
        message: 'We were unable to complete the backtest for this symbol',
      },
      { status: 500 }
    );
  }
}
