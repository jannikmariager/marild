export type FetchSignalsOptions = {
  minConfidence?: number;
  allowlistSymbols?: string[] | null;
  allowlistBypassConfidence?: boolean;
};

export async function fetchSignalsWithAllowlist(
  supabase: any,
  engineType: string,
  createdAfterIso: string,
  options: FetchSignalsOptions = {},
): Promise<{ data: any[] | null; error: any }> {
  const minConfidence = options.minConfidence ?? 60;
  const allowlistBypassConfidence = options.allowlistBypassConfidence ?? false;

  const baseQuery = supabase
    .from("ai_signals")
    .select("*")
    .eq("engine_type", engineType)
    .gte("confidence_score", minConfidence)
    .gte("created_at", createdAfterIso)
    .order("created_at", { ascending: false });

  const sanitizedAllowlist = (options.allowlistSymbols || [])
    .map((symbol) => symbol?.trim().toUpperCase())
    .filter((symbol): symbol is string => Boolean(symbol));

  if (sanitizedAllowlist.length === 0) {
    return await baseQuery;
  }

  let allowlistQuery = supabase
    .from("ai_signals")
    .select("*")
    .eq("engine_type", engineType)
    .in("symbol", sanitizedAllowlist)
    .gte("created_at", createdAfterIso)
    .order("created_at", { ascending: false });

  if (!allowlistBypassConfidence) {
    allowlistQuery = allowlistQuery.gte("confidence_score", minConfidence);
  }

  const [baseResult, allowlistResult] = await Promise.all([baseQuery, allowlistQuery]);

  if (baseResult.error) return baseResult;
  if (allowlistResult.error) return allowlistResult;

  const merged = new Map<string, any>();
  for (const row of baseResult.data || []) {
    merged.set(row.id, row);
  }
  for (const row of allowlistResult.data || []) {
    merged.set(row.id, row);
  }

  return { data: Array.from(merged.values()), error: null };
}
