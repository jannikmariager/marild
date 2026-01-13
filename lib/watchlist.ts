// Watchlists have been removed. These helpers remain only to satisfy legacy imports.

export interface WatchlistItem {
  ticker: string;
  addedAt: Date;
}

export async function validateApprovedTicker(_ticker: string): Promise<null> {
  return null;
}

export async function addToWatchlist(
  _ticker: string,
  _userId: string
): Promise<{ success: boolean; error?: string }> {
  return {
    success: false,
    error: 'Watchlists are disabled in this version of the app.',
  };
}

export async function removeFromWatchlist(
  _ticker: string,
  _userId: string
): Promise<{ success: boolean; error?: string }> {
  return {
    success: false,
    error: 'Watchlists are disabled in this version of the app.',
  };
}

export async function getWatchlist(_userId: string): Promise<WatchlistItem[]> {
  return [];
}
