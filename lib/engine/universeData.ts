import { createClient } from "@/lib/supabase/server";
import type { TickerStats } from "@/lib/engine/universeEvaluation";

async function getSupabase() {
  const supabase = await createClient();
  return supabase;
}

export async function loadTickerStats(engineVersion: string): Promise<TickerStats[]> {
  const supabase = await getSupabase();

  const { data, error } = await supabase.rpc("engine_ticker_stats", {
    engine_version_arg: engineVersion,
  });

  if (error) {
    console.error("[loadTickerStats] rpc error", error);
    throw error;
  }

  return (data || []) as TickerStats[];
}

export async function loadUniverse(name: string): Promise<string[]> {
  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from("engine_universe")
    .select("tickers")
    .eq("universe_name", name)
    .maybeSingle();

  if (error) {
    console.error("[loadUniverse] error", error);
    throw error;
  }

  return ((data?.tickers as string[]) || []).map((t) => t.toUpperCase());
}
