// Centralized AI router for TradeLens AI
// - Only uses: gpt-4o and gpt-4o-mini
// - Trial users are forced to gpt-4o-mini
// - Handles caching, logging, and simple cost control

import OpenAI from "https://esm.sh/openai@4.20.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const openai = new OpenAI({ apiKey: Deno.env.get("OPENAI_API_KEY")! });

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ---------- Types ----------

export type UserTier = "trial" | "free" | "pro" | "admin";

export type AiTask =
  | "smc_summary"
  | "smc_trade_setups"
  | "home_daily_summary"
  | "short_snippet"
  | "onboarding_explanation";

interface AiRequest {
  userId: string;
  tier: UserTier;
  task: AiTask;
  prompt: string;          // already fully formed system+user prompt or just user text
  system?: string;         // optional system prompt override
  cacheKey?: string;       // if provided, we try cache first
  maxTokens?: number;
}

// cheap/expensive defaults per task
const TASK_CONFIG: Record<AiTask, { model: "gpt-4o" | "gpt-4o-mini"; maxTokens: number }> = {
  smc_summary:        { model: "gpt-4o",      maxTokens: 450 },
  smc_trade_setups:   { model: "gpt-4o",      maxTokens: 650 },
  home_daily_summary: { model: "gpt-4o-mini", maxTokens: 250 },
  short_snippet:      { model: "gpt-4o-mini", maxTokens: 150 },
  onboarding_explanation: { model: "gpt-4o-mini", maxTokens: 200 },
};

// ---------- Cache helpers ----------

async function getCachedResponse(cacheKey: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("ai_cache")
    .select("response, created_at, ttl_seconds")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (!data || error) return null;

  const createdAt = new Date(data.created_at).getTime();
  const ageSec = (Date.now() - createdAt) / 1000;
  if (ageSec > data.ttl_seconds) {
    // expired: best-effort delete, but don't block the call
    await supabase.from("ai_cache").delete().eq("cache_key", cacheKey);
    return null;
  }

  return data.response as string;
}

async function setCachedResponse(cacheKey: string, model: string, response: string, ttlSeconds: number) {
  await supabase.from("ai_cache").upsert({
    cache_key: cacheKey,
    response,
    model,
    ttl_seconds: ttlSeconds,
  });
}

// ---------- Logging helper ----------

async function logUsage(params: {
  userId: string;
  model: string;
  task: AiTask;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}) {
  const { userId, model, task, inputTokens, outputTokens, costUsd } = params;
  await supabase.from("ai_usage_logs").insert({
    user_id: userId,
    model,
    task,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: costUsd,
  });
}

// REAL OpenAI pricing per 1M tokens
const COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o":      { input: 2.50, output: 10.00 },  // $2.50 / $10 exact prices
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
};

// ---------- Core router ----------

export async function callAi(req: AiRequest): Promise<string> {
  const { userId, tier, task, prompt, system, cacheKey } = req;

  // 1) Determine base model from task
  let baseModel = TASK_CONFIG[task].model;
  let maxTokens = req.maxTokens ?? TASK_CONFIG[task].maxTokens;

  // 2) Force trial users to gpt-4o-mini ALWAYS
  if (tier === "trial") {
    baseModel = "gpt-4o-mini";
    // also clamp max tokens lower for safety
    maxTokens = Math.min(maxTokens, 320);
  }

  // 3) Optional: free users can only hit cache
  if (tier === "free") {
    if (!cacheKey) {
      throw new Error("Free tier can only access cached AI responses.");
    }
    const cached = await getCachedResponse(cacheKey);
    if (!cached) {
      throw new Error("No cached AI result available for free tier.");
    }
    return cached;
  }

  // 4) For Pro/Admin: check cache first if cacheKey given
  if (cacheKey) {
    const cached = await getCachedResponse(cacheKey);
    if (cached) return cached;
  }

  // 5) Make the OpenAI call
  const systemPrompt =
    system ??
    "You are TradeLens AI, an expert trading assistant. Be concise, practical and avoid promises of guaranteed returns.";

  const completion = await openai.chat.completions.create({
    model: baseModel,
    max_tokens: maxTokens,
    temperature: 0.4,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
  });

  const message = completion.choices[0]?.message?.content ?? "";
  const usage = completion.usage;

  if (usage) {
    const pricing = COST_PER_MILLION[baseModel];
    const costUsd =
      ((usage.prompt_tokens ?? 0) / 1_000_000) * pricing.input +
      ((usage.completion_tokens ?? 0) / 1_000_000) * pricing.output;

    await logUsage({
      userId,
      model: baseModel,
      task,
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      costUsd,
    });
  }

  // 6) Store in cache (for Pro/Admin) if cacheKey passed
  if (cacheKey) {
    // TTL strategy per task
    const ttlMap: Partial<Record<AiTask, number>> = {
      home_daily_summary: 60 * 60 * 4, // 4h
      smc_summary:        60 * 30,     // 30m
    };
    const ttl = ttlMap[task] ?? 60 * 10; // default 10m
    await setCachedResponse(cacheKey, baseModel, message, ttl);
  }

  return message;
}
