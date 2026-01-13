'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabaseBrowser';
import type { TradingStyle } from '@/components/tradesignal/trading-style-selector';

interface UseTradingStyleReturn {
  tradingStyle: TradingStyle;
  setTradingStyle: (style: TradingStyle) => void;
  defaultTradingStyle: TradingStyle;
  isLoading: boolean;
}

export function useTradingStyle(initialStyle?: TradingStyle): UseTradingStyleReturn {
  const [tradingStyle, setTradingStyle] = useState<TradingStyle>(initialStyle || 'swing');
  const [defaultTradingStyle, setDefaultTradingStyle] = useState<TradingStyle>('swing');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadUserDefault() {
      try {
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (user) {
          const { data: profile } = await supabase
            .from('user_profile')
            .select('trading_style')
            .eq('user_id', user.id)
            .single();

          if (profile?.trading_style) {
            const userStyle = profile.trading_style as TradingStyle;
            setDefaultTradingStyle(userStyle);
            
            // Only set if no initial style was provided
            if (!initialStyle) {
              setTradingStyle(userStyle);
            }
          }
        }
      } catch (error) {
        console.error('Error loading user trading style:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadUserDefault();
  }, [initialStyle]);

  return {
    tradingStyle,
    setTradingStyle,
    defaultTradingStyle,
    isLoading,
  };
}
