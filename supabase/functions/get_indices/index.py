"""
Get Indices Edge Function

Fetches global market indices from Yahoo Finance with caching.
Supports major indices (S&P 500, NASDAQ, FTSE, etc.)
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


# Major global indices with their Yahoo Finance ticker codes
MAJOR_INDICES = {
    "SP500": "^GSPC",      # S&P 500
    "NASDAQ": "^IXIC",     # NASDAQ Composite
    "DOW": "^DJI",         # Dow Jones Industrial Average
    "FTSE": "^FTSE",       # FTSE 100 (UK)
    "DAX": "^GDAXI",       # DAX (Germany)
    "NIKKEI": "^N225",     # Nikkei 225 (Japan)
    "HANGSENG": "^HSI",    # Hang Seng (Hong Kong)
    "CAC40": "^FCHI",      # CAC 40 (France)
    "SENSEX": "^BSESN",    # BSE Sensex (India)
    "ASX200": "^AXJO",     # ASX 200 (Australia)
}


def validate_request(request_data: Dict[str, Any]) -> tuple[bool, Any]:
    """Validate incoming request."""
    # Support both single index or multiple indices
    indices = request_data.get("indices") or request_data.get("index")
    
    if not indices:
        # If no specific indices requested, return all major indices
        return True, list(MAJOR_INDICES.values())
    
    # Handle single index
    if isinstance(indices, str):
        indices = [indices]
    
    # Validate and convert to Yahoo tickers
    ticker_list = []
    for index in indices:
        index_upper = index.upper()
        
        # Check if it's a known name
        if index_upper in MAJOR_INDICES:
            ticker_list.append(MAJOR_INDICES[index_upper])
        # Check if it's already a Yahoo ticker (starts with ^)
        elif index.startswith("^"):
            ticker_list.append(index.upper())
        else:
            return False, f"Unknown index: {index}"
    
    return True, ticker_list


async def handler(request):
    """Main request handler."""
    try:
        # Parse request body
        body = await request.json() if request.method == "POST" else {}
        
        # Validate request
        is_valid, result = validate_request(body)
        if not is_valid:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": result}),
                "headers": {"Content-Type": "application/json"},
            }
        
        # Get ticker list
        ticker_list = result
        
        # Extract parameters
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
        
        # Check cache for each index
        for ticker in ticker_list:
            cached_data = await cache_manager.get_cached_data(ticker, range_period, interval)
            if cached_data:
                cached_data["cached"] = True
                cached_data["asset_type"] = "index"
                results.append(cached_data)
            else:
                tickers_to_fetch.append(ticker)
        
        # Fetch uncached indices from Yahoo Finance
        if tickers_to_fetch:
            for ticker in tickers_to_fetch:
                try:
                    ticker_obj = yf.Ticker(ticker)
                    normalized_data = YFinanceNormalizer.normalize_ticker_data(
                        ticker_obj,
                        include_history=include_history,
                        range_period=range_period,
                    )
                    
                    # Add index metadata
                    normalized_data["cached"] = False
                    normalized_data["asset_type"] = "index"
                    
                    # Cache the result
                    await cache_manager.set_cached_data(ticker, normalized_data, range_period, interval)
                    
                    results.append(normalized_data)
                    
                except Exception as e:
                    # Add error entry for this index
                    results.append({
                        "ticker": ticker,
                        "error": f"Failed to fetch: {str(e)}",
                        "price": 0,
                        "change_percent": 0,
                        "asset_type": "index",
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
