/**
 * Get Quote Bulk Edge Function
 * Returns real-time quotes for multiple tickers
 * Optimized for watchlist display with caching and automatic retries
 * 
 * MIGRATED: Now uses yahoo_v8_client.ts (2025-11-29)
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { fetchBulkQuotes, type QuoteResult } from '../_shared/yahoo_v8_client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Simple ticker validation
function isValidTicker(ticker: string): boolean {
  if (!ticker || typeof ticker !== 'string') return false;
  const trimmed = ticker.trim();
  return trimmed.length > 0 && trimmed.length <= 15 && /^[A-Z0-9.^=-]+$/i.test(trimmed);
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    let symbols: string[] = [];

    // Support both GET and POST
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const symbolParam = url.searchParams.get('symbols') || url.searchParams.get('symbol');
      if (symbolParam) {
        symbols = symbolParam.split(',').map(s => s.trim().toUpperCase());
      }
    } else if (req.method === 'POST') {
      const body = await req.json();
      
      // Support both 'symbols' array and 'symbol' string
      if (Array.isArray(body.symbols)) {
        symbols = body.symbols.map((s: string) => s.trim().toUpperCase());
      } else if (body.symbol) {
        symbols = [body.symbol.trim().toUpperCase()];
      } else if (Array.isArray(body.tickers)) {
        // Also support 'tickers' for backwards compatibility
        symbols = body.tickers.map((s: string) => s.trim().toUpperCase());
      } else if (body.ticker) {
        symbols = [body.ticker.trim().toUpperCase()];
      }
    }

    // Validate input
    if (symbols.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'missing_symbols', 
          message: 'At least one symbol is required (use "symbols" array or "symbol" string)' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Limit to 50 symbols per request
    if (symbols.length > 50) {
      return new Response(
        JSON.stringify({ 
          error: 'too_many_symbols', 
          message: 'Maximum 50 symbols per request' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Filter invalid tickers
    const validSymbols = symbols.filter(isValidTicker);
    const invalidSymbols = symbols.filter(s => !isValidTicker(s));

    // Fetch quotes using yahoo_v8_client (includes caching, retries)
    const quotesMap = await fetchBulkQuotes(validSymbols);
    
    // Build results array in same order as input
    const results: Array<QuoteResult & { error?: string }> = [];
    
    for (const symbol of symbols) {
      if (invalidSymbols.includes(symbol)) {
        results.push({
          symbol: symbol.trim().toUpperCase(),
          price: null,
          change: null,
          changePercent: null,
          volume: null,
          open: null,
          previousClose: null,
          dayHigh: null,
          dayLow: null,
          fiftyTwoWeekHigh: null,
          fiftyTwoWeekLow: null,
          error: 'Invalid ticker format',
        });
      } else {
        const normalizedSymbol = symbol.trim().toUpperCase();
        const quote = quotesMap[normalizedSymbol];
        if (quote) {
          results.push(quote);
        } else {
          results.push({
            symbol: normalizedSymbol,
            price: null,
            change: null,
            changePercent: null,
            volume: null,
            open: null,
            previousClose: null,
            dayHigh: null,
            dayLow: null,
            fiftyTwoWeekHigh: null,
            fiftyTwoWeekLow: null,
            error: 'Unable to fetch quote',
          });
        }
      }
    }

    // Return results in same order as input
    return new Response(
      JSON.stringify({ quotes: results }),
      { 
        status: 200, 
        headers: { 
          ...corsHeaders, 
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=60',
        } 
      }
    );
  } catch (error) {
    console.error('Function error:', error);
    return new Response(
      JSON.stringify({ 
        error: 'internal_error', 
        message: error.message || 'Unknown error occurred' 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
