"use server";

import { createAdminClient } from "@/lib/supabase/server";

export type StrategyFlagRow = {
  strategy: string;
  allow_capital_recycling: boolean;
  allow_slot_release: boolean;
  is_trend_follower: boolean;
};

export async function getStrategyFlags(): Promise<StrategyFlagRow[]> {
  const supabase = await createAdminClient();
  const { data, error } = await supabase
    .from("strategy_flags")
    .select("strategy, allow_capital_recycling, allow_slot_release, is_trend_follower")
    .order("strategy", { ascending: true });

  if (error) {
    console.error("[admin/getStrategyFlags] failed to load strategy_flags", error);
    return [];
  }

  return (data || []) as StrategyFlagRow[];
}

export async function updateStrategyFlags(
  strategy: string,
  flags: Partial<Pick<StrategyFlagRow, "allow_capital_recycling" | "allow_slot_release" | "is_trend_follower">>,
): Promise<{ success: boolean }> {
  const supabase = await createAdminClient();

  const { error } = await supabase
    .from("strategy_flags")
    .upsert(
      {
        strategy,
        ...flags,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "strategy" }
    );

  if (error) {
    console.error("[admin/updateStrategyFlags] failed", error);
    throw error;
  }

  return { success: true };
}
