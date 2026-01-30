"""
Get Crypto Edge Function

Fetches cryptocurrency data from Yahoo Finance with caching.
Supports major crypto pairs (BTC-USD, ETH-USD, etc.)
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


# Supported crypto symbols
SUPPORTED_CRYPTO = {
    "BTC", "ETH", "BNB", "XRP", "ADA", "SOL", "DOGE", "MATIC", "DOT", "AVAX",
    "SHIB", "LTC", "UNI", "LINK", "XLM", "ALGO", "ATOM", "NEAR", "FTM", "APE"
}


def validate_request(request_data: Dict[str, Any]) -> tuple[bool, str]:
    """Validate incoming request."""
    symbol = request_data.get("symbol")
    if not symbol:
        return False, "Missing required parameter: symbol"
    
    # Normalize crypto symbol (e.g., "BTC" -> "BTC-USD")
    if "-" not in symbol:
        base_symbol = symbol.upper()
        if base_symbol not in SUPPORTED_CRYPTO:
            return False, f"Unsupported crypto symbol: {symbol}. Use format like BTC-USD"
        symbol = f"{base_symbol}-USD"
    
    if not YFinanceNormalizer.validate_ticker_symbol(symbol):
        return False, f"Invalid crypto symbol format: {symbol}"
    
    return True, symbol.upper()


async def handler(request):
    """Main request handler."""
    try:
        # Parse request body
        body = await request.json()
        
        # Validate request
        is_valid, result = validate_request(body)
        if not is_valid:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": result}),
                "headers": {"Content-Type": "application/json"},
            }
        
        # Get normalized symbol
        symbol = result
        
        # Extract parameters
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
        cached_data = await cache_manager.get_cached_data(symbol, range_period, interval)
        if cached_data:
            cached_data["cached"] = True
            cached_data["asset_type"] = "crypto"
            return {
                "statusCode": 200,
                "body": json.dumps(cached_data),
                "headers": {"Content-Type": "application/json"},
            }
        
        # Fetch from Yahoo Finance
        ticker_obj = yf.Ticker(symbol)
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
        
        # Add crypto metadata
        normalized_data["cached"] = False
        normalized_data["asset_type"] = "crypto"
        
        # Cache the result
        await cache_manager.set_cached_data(symbol, normalized_data, range_period, interval)
        
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
