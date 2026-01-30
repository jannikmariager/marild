"""
Yahoo Finance Cache Manager

Implements caching with configurable TTL to reduce Yahoo Finance API calls.
Uses Supabase database for persistent caching across Edge Function invocations.
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, Optional, Any
import json


class YFinanceCacheManager:
    """Manages caching for Yahoo Finance data."""

    # Cache duration in seconds
    CACHE_DURATION_HIGH_VOLUME = 300  # 5 minutes for popular tickers
    CACHE_DURATION_NORMAL = 600  # 10 minutes for normal tickers

    # High-volume tickers (FAANG + crypto + major indices)
    HIGH_VOLUME_TICKERS = {
        "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "NVDA",
        "BTC-USD", "ETH-USD", "^GSPC", "^IXIC", "^DJI"
    }

    def __init__(self, supabase_client):
        """
        Initialize cache manager.

        Args:
            supabase_client: Supabase client instance for database operations
        """
        self.supabase = supabase_client

    def get_cache_key(self, ticker: str, range_period: str = "1d", interval: str = "1d") -> str:
        """
        Generate cache key for a ticker request.

        Args:
            ticker: Ticker symbol
            range_period: Time range (e.g., "1d", "1mo")
            interval: Data interval (e.g., "1d", "1h")

        Returns:
            Cache key string
        """
        return f"yf:{ticker.upper()}:{range_period}:{interval}"

    def get_cache_duration(self, ticker: str) -> int:
        """
        Get cache duration for a ticker.

        Args:
            ticker: Ticker symbol

        Returns:
            Cache duration in seconds
        """
        if ticker.upper() in self.HIGH_VOLUME_TICKERS:
            return self.CACHE_DURATION_HIGH_VOLUME
        return self.CACHE_DURATION_NORMAL

    async def get_cached_data(
        self, ticker: str, range_period: str = "1d", interval: str = "1d"
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieve cached data if available and valid.

        Args:
            ticker: Ticker symbol
            range_period: Time range
            interval: Data interval

        Returns:
            Cached data dict or None if not found/expired
        """
        try:
            cache_key = self.get_cache_key(ticker, range_period, interval)
            
            # Query market_cache table
            result = self.supabase.table("market_cache") \
                .select("data, expires_at") \
                .eq("id", cache_key) \
                .maybe_single() \
                .execute()

            if not result.data:
                return None

            # Check if cache is still valid
            expires_at = datetime.fromisoformat(result.data["expires_at"].replace("Z", "+00:00"))
            if expires_at < datetime.now(timezone.utc):
                # Cache expired, delete it
                await self.delete_cache(cache_key)
                return None

            # Return cached data
            return result.data["data"]

        except Exception as e:
            print(f"Cache retrieval error: {e}")
            return None

    async def set_cached_data(
        self, ticker: str, data: Dict[str, Any], range_period: str = "1d", interval: str = "1d"
    ) -> bool:
        """
        Store data in cache with TTL.

        Args:
            ticker: Ticker symbol
            data: Normalized data to cache
            range_period: Time range
            interval: Data interval

        Returns:
            True if successfully cached, False otherwise
        """
        try:
            cache_key = self.get_cache_key(ticker, range_period, interval)
            cache_duration = self.get_cache_duration(ticker)
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=cache_duration)

            # Upsert into market_cache table
            self.supabase.table("market_cache").upsert({
                "id": cache_key,
                "data": data,
                "expires_at": expires_at.isoformat(),
            }).execute()

            return True

        except Exception as e:
            print(f"Cache storage error: {e}")
            return False

    async def delete_cache(self, cache_key: str) -> bool:
        """
        Delete a cache entry.

        Args:
            cache_key: Cache key to delete

        Returns:
            True if deleted, False otherwise
        """
        try:
            self.supabase.table("market_cache").delete().eq("id", cache_key).execute()
            return True
        except Exception as e:
            print(f"Cache deletion error: {e}")
            return False

    async def invalidate_ticker_cache(self, ticker: str) -> int:
        """
        Invalidate all cache entries for a ticker.

        Args:
            ticker: Ticker symbol

        Returns:
            Number of cache entries deleted
        """
        try:
            # Delete all entries starting with "yf:{ticker}:"
            result = self.supabase.table("market_cache") \
                .delete() \
                .like("id", f"yf:{ticker.upper()}:%") \
                .execute()
            
            return len(result.data) if result.data else 0

        except Exception as e:
            print(f"Cache invalidation error: {e}")
            return 0

    async def cleanup_expired_cache(self) -> int:
        """
        Remove all expired cache entries.

        Returns:
            Number of entries deleted
        """
        try:
            now = datetime.now(timezone.utc).isoformat()
            result = self.supabase.table("market_cache") \
                .delete() \
                .lt("expires_at", now) \
                .execute()
            
            return len(result.data) if result.data else 0

        except Exception as e:
            print(f"Cache cleanup error: {e}")
            return 0
