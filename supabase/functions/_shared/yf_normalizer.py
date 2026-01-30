"""
Yahoo Finance Data Normalizer

Converts raw yfinance data into a unified JSON schema for consistent
consumption by the Flutter frontend.
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional, Any
import pandas as pd


class YFinanceNormalizer:
    """Normalizes raw yfinance data to unified schema."""

    @staticmethod
    def normalize_ticker_data(
        ticker_obj: Any,
        include_history: bool = False,
        range_period: str = "1mo",
    ) -> Dict[str, Any]:
        """
        Normalize ticker data to unified schema.

        Args:
            ticker_obj: yfinance Ticker object
            include_history: Whether to include historical price data
            range_period: Time range for historical data (e.g., "1d", "1mo", "1y")

        Returns:
            Normalized data dictionary
        """
        try:
            info = ticker_obj.info
            history = ticker_obj.history(period=range_period) if include_history else None

            # Get current price (prefer regularMarketPrice, fallback to currentPrice)
            current_price = info.get("regularMarketPrice") or info.get("currentPrice", 0)
            previous_close = info.get("previousClose", current_price)

            # Calculate change percentage
            change_percent = 0
            if previous_close and previous_close > 0:
                change_percent = ((current_price - previous_close) / previous_close) * 100

            # Get latest market data
            open_price = info.get("regularMarketOpen") or info.get("open", 0)
            high_price = info.get("dayHigh") or info.get("regularMarketDayHigh", 0)
            low_price = info.get("dayLow") or info.get("regularMarketDayLow", 0)
            volume = info.get("volume") or info.get("regularMarketVolume", 0)

            normalized = {
                "ticker": info.get("symbol", "UNKNOWN"),
                "name": info.get("longName") or info.get("shortName", ""),
                "price": round(current_price, 2) if current_price else 0,
                "change_percent": round(change_percent, 2),
                "open": round(open_price, 2) if open_price else 0,
                "close": round(previous_close, 2) if previous_close else 0,
                "high": round(high_price, 2) if high_price else 0,
                "low": round(low_price, 2) if low_price else 0,
                "volume": int(volume) if volume else 0,
                "currency": info.get("currency", "USD"),
                "market_cap": info.get("marketCap"),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            # Add historical data if requested
            if include_history and history is not None and not history.empty:
                normalized["history"] = YFinanceNormalizer._normalize_history(history)

            return normalized

        except Exception as e:
            return YFinanceNormalizer._error_response(
                ticker=getattr(ticker_obj, "ticker", "UNKNOWN"),
                error=str(e),
            )

    @staticmethod
    def normalize_multiple_tickers(
        ticker_data: Dict[str, Any], include_history: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Normalize multiple tickers at once.

        Args:
            ticker_data: Dict mapping ticker symbols to yfinance Ticker objects
            include_history: Whether to include historical data

        Returns:
            List of normalized ticker dictionaries
        """
        results = []
        for symbol, ticker_obj in ticker_data.items():
            normalized = YFinanceNormalizer.normalize_ticker_data(
                ticker_obj, include_history=include_history
            )
            results.append(normalized)
        return results

    @staticmethod
    def _normalize_history(history_df: pd.DataFrame) -> List[Dict[str, Any]]:
        """
        Convert pandas DataFrame history to list of dicts.

        Args:
            history_df: pandas DataFrame from yfinance history()

        Returns:
            List of timestamp/price/volume dicts
        """
        history_list = []
        for timestamp, row in history_df.iterrows():
            history_list.append({
                "timestamp": timestamp.isoformat(),
                "price": round(float(row["Close"]), 2),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "volume": int(row["Volume"]) if pd.notna(row["Volume"]) else 0,
            })
        return history_list

    @staticmethod
    def _error_response(ticker: str, error: str) -> Dict[str, Any]:
        """
        Return error response in normalized format.

        Args:
            ticker: Ticker symbol
            error: Error message

        Returns:
            Error response dictionary
        """
        return {
            "ticker": ticker,
            "error": error,
            "price": 0,
            "change_percent": 0,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def validate_ticker_symbol(ticker: str) -> bool:
        """
        Basic validation for ticker symbols.

        Args:
            ticker: Ticker symbol to validate

        Returns:
            True if valid format, False otherwise
        """
        if not ticker or len(ticker) > 10:
            return False
        # Allow alphanumeric, hyphens, dots, carets (for indices)
        allowed_chars = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._^")
        return all(c in allowed_chars for c in ticker.upper())
