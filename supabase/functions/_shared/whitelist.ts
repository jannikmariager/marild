type SupabaseClient = {
  from: (table: string) => any;
};

export type WhitelistedTicker = {
  symbol: string;
  is_top8: boolean;
  manual_priority: number;
};

export async function getWhitelistedTickers(
  supabase: SupabaseClient,
): Promise<WhitelistedTicker[]> {
  const { data, error } = await supabase
    .from('ticker_whitelist')
    .select('symbol, is_top8, manual_priority, is_enabled')
    .eq('is_enabled', true)
    .order('is_top8', { ascending: false })
    .order('manual_priority', { ascending: false })
    .order('symbol', { ascending: true });

  if (error) {
    console.error('[whitelist] Failed to load ticker_whitelist:', error);
    return [];
  }

  const normalized = (data ?? [])
    .map((row: any) => ({
      symbol: (row.symbol || '').toUpperCase().trim(),
      is_top8: Boolean(row.is_top8),
      manual_priority: Number(row.manual_priority ?? 0),
    }))
    .filter((row) => row.symbol.length > 0);

  return normalized;
}

export function logUniverseStats(source: string, enabledCount: number) {
  console.log(`[universe] source=${source} enabled_count=${enabledCount}`);
}
