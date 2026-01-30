"""
Get Multiple Stocks Edge Function

Fetches multiple stock data from Yahoo Finance with caching.
Efficiently handles batch requests for watchlists and market overview.
"""

import json
import os
import sys
from typing import Dict, Any, List

# Add shared modules to path
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "_shared"))

import yfinance as yf
from supabase import create_client
from yf_normalizer import YFinanceNormalizer
from yf_cache import YFinanceCacheManager


def validate_request(request_data: Dict[str, Any]) -> tuple[bool, str]:
    """Validate incoming request."""
    tickers = request_data.get("tickers")
    if not tickers:
        return False, "Missing required parameter: tickers"
    
    # Support both comma-separated string and list
    if isinstance(tickers, str):
        ticker_list = [t.strip() for t in tickers.split(",")]
    elif isinstance(tickers, list):
        ticker_list = tickers
    else:
        return False, "tickers must be a comma-separated string or list"
    
    if len(ticker_list) > 50:
        return False, "Maximum 50 tickers per request"
    
    # Validate each ticker
    for ticker in ticker_list:
        if not YFinanceNormalizer.validate_ticker_symbol(ticker):
            return False, f"Invalid ticker symbol: {ticker}"
    
    return True, ""


async def handler(request):
    """Main request handler."""
    try:
        # Parse request body
        body = await request.json()
        
        # Validate request
        is_valid, error_msg = validate_request(body)
        if not is_valid:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": error_msg}),
                "headers": {"Content-Type": "application/json"},
            }
        
        # Extract parameters
        tickers = body.get("tickers")
        if isinstance(tickers, str):
            ticker_list = [t.strip().upper() for t in tickers.split(",")]
        else:
            ticker_list = [t.upper() for t in tickers]
        
        range_period = body.get("range", "1d")
        interval = body.get("interval", "1d")
        include_history = body.get("include_history", False)
        
        # Initialize Supabase client
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        supabase = create_client(supabase_url, supabase_key)
        
        # Initialize cache manager
        cache_manager = YFinanceCacheManager(supabase)
        
        # Results container
        results = []
        tickers_to_fetch = []
        
        # Check cache for each ticker
        for ticker in ticker_list:
            cached_data = await cache_manager.get_cached_data(ticker, range_period, interval)
            if cached_data:
                cached_data["cached"] = True
                results.append(cached_data)
            else:
                tickers_to_fetch.append(ticker)
        
        # Fetch uncached tickers from Yahoo Finance
        if tickers_to_fetch:
            # Use yfinance's batch download for efficiency
            for ticker in tickers_to_fetch:
                try:
                    ticker_obj = yf.Ticker(ticker)
                    normalized_data = YFinanceNormalizer.normalize_ticker_data(
                        ticker_obj,
                        include_history=include_history,
                        range_period=range_period,
                    )
                    
                    # Cache the result (even if error, to avoid repeated failures)
                    normalized_data["cached"] = False
                    await cache_manager.set_cached_data(ticker, normalized_data, range_period, interval)
                    
                    results.append(normalized_data)
                    
                except Exception as e:
                    # Add error entry for this ticker
                    results.append({
                        "ticker": ticker,
                        "error": f"Failed to fetch: {str(e)}",
                        "price": 0,
                        "change_percent": 0,
                    })
        
        # Return response
        return {
            "statusCode": 200,
            "body": json.dumps({
                "data": results,
                "total": len(results),
                "cached": len(results) - len(tickers_to_fetch),
                "fetched": len(tickers_to_fetch),
            }),
            "headers": {"Content-Type": "application/json"},
        }
        
    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({"error": f"Internal server error: {str(e)}"}),
            "headers": {"Content-Type": "application/json"},
        }
