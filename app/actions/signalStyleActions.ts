"use server";

import { createClient } from "@/lib/supabaseServer";
import type { SignalStyle } from "@/lib/engine/v74_presets";

const FALLBACK_STYLE: SignalStyle = "balanced";

function normalizeStyle(style: string | null | undefined): SignalStyle {
  if (style === "conservative" || style === "precision" || style === "balanced") {
    return style;
  }
  return FALLBACK_STYLE;
}

export async function getUserSignalStyle(): Promise<SignalStyle> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return FALLBACK_STYLE;
  }

  const { data, error } = await supabase
    .from("user_profile")
    .select("signal_style")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("[getUserSignalStyle] error fetching signal_style", error);
    return FALLBACK_STYLE;
  }

  return normalizeStyle((data as any)?.signal_style);
}

export async function setUserSignalStyle(style: SignalStyle): Promise<void> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Not authenticated");
  }

  const nextStyle = normalizeStyle(style);

  const { error } = await supabase
    .from("user_profile")
    .update({ signal_style: nextStyle })
    .eq("user_id", user.id);

  if (error) {
    console.error("[setUserSignalStyle] failed to update signal_style", error);
    throw error;
  }
}
