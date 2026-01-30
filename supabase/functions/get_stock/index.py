"""
Get Stock Edge Function

Fetches stock data from Yahoo Finance with caching.
Supports single stock queries with optional historical data.
"""

import json
import os
import sys
from typing import Dict, Any

# Add shared modules to path
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "_shared"))

import yfinance as yf
from supabase import create_client
from yf_normalizer import YFinanceNormalizer
from yf_cache import YFinanceCacheManager


def validate_request(request_data: Dict[str, Any]) -> tuple[bool, str]:
    """Validate incoming request."""
    ticker = request_data.get("ticker")
    if not ticker:
        return False, "Missing required parameter: ticker"
    
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
        ticker = body.get("ticker").upper()
        range_period = body.get("range", "1mo")
        interval = body.get("interval", "1d")
        include_history = body.get("include_history", False)
        
        # Initialize Supabase client
        supabase_url = os.environ.get("SUPABASE_URL")
        supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        supabase = create_client(supabase_url, supabase_key)
        
        # Initialize cache manager
        cache_manager = YFinanceCacheManager(supabase)
        
        # Check cache first
        cached_data = await cache_manager.get_cached_data(ticker, range_period, interval)
        if cached_data:
            cached_data["cached"] = True
            return {
                "statusCode": 200,
                "body": json.dumps(cached_data),
                "headers": {"Content-Type": "application/json"},
            }
        
        # Fetch from Yahoo Finance
        ticker_obj = yf.Ticker(ticker)
        normalized_data = YFinanceNormalizer.normalize_ticker_data(
            ticker_obj,
            include_history=include_history,
            range_period=range_period,
        )
        
        # Check for errors
        if "error" in normalized_data:
            return {
                "statusCode": 404,
                "body": json.dumps(normalized_data),
                "headers": {"Content-Type": "application/json"},
            }
        
        # Cache the result
        normalized_data["cached"] = False
        await cache_manager.set_cached_data(ticker, normalized_data, range_period, interval)
        
        # Return response
        return {
            "statusCode": 200,
            "body": json.dumps(normalized_data),
            "headers": {"Content-Type": "application/json"},
        }
        
    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({"error": f"Internal server error: {str(e)}"}),
            "headers": {"Content-Type": "application/json"},
        }
