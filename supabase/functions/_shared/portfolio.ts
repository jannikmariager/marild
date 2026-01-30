export async function getLiveStartingEquity(
  supabase: any,
  strategy: string,
  fallback = 100000,
): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("live_portfolio_state")
      .select("equity_dollars")
      .eq("strategy", strategy)
      .order("timestamp", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[portfolio] Failed to fetch live equity:", error);
      return fallback;
    }

    return Number(data?.equity_dollars ?? fallback);
  } catch (err) {
    console.warn("[portfolio] Unexpected error fetching live equity:", err);
    return fallback;
  }
}
