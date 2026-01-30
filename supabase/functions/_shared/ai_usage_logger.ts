/**
 * AI Usage Logger
 * Centralized utility for logging AI token usage and costs to ai_usage_logs table
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// OpenAI pricing per 1M tokens (as of Dec 2024)
const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4': { input: 30.00, output: 60.00 },
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
};

// Anthropic pricing per 1M tokens
const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
  'claude-3-opus-20240229': { input: 15.00, output: 75.00 },
  'claude-3-sonnet-20240229': { input: 3.00, output: 15.00 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

export interface LogAiUsageParams {
  userId: string; // Use 'system' for system-level calls
  model: string;
  task: string; // e.g. 'news_sentiment', 'quick_action', 'smc_summary', etc.
  inputTokens: number;
  outputTokens: number;
}

/**
 * Calculate cost based on model and token counts
 */
function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Try OpenAI pricing first
  let pricing = OPENAI_PRICING[model];
  
  // Fallback to Anthropic pricing
  if (!pricing) {
    pricing = ANTHROPIC_PRICING[model];
  }
  
  // If model not found, estimate using gpt-4o-mini pricing
  if (!pricing) {
    console.warn(`[ai_usage_logger] Unknown model: ${model}, using gpt-4o-mini pricing`);
    pricing = OPENAI_PRICING['gpt-4o-mini'];
  }
  
  const costUsd = 
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output;
  
  return costUsd;
}

/**
 * Log AI usage to ai_usage_logs table
 */
export async function logAiUsage(params: LogAiUsageParams): Promise<void> {
  const { userId, model, task, inputTokens, outputTokens } = params;
  
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    
    const costUsd = calculateCost(model, inputTokens, outputTokens);
    
    const { error } = await supabase.from('ai_usage_logs').insert({
      user_id: userId,
      model,
      task,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: costUsd,
    });
    
    if (error) {
      console.error('[ai_usage_logger] Failed to log usage:', error);
    } else {
      console.log(`[ai_usage_logger] Logged: ${model} | ${task} | ${inputTokens + outputTokens} tokens | $${costUsd.toFixed(4)}`);
    }
  } catch (err) {
    console.error('[ai_usage_logger] Unexpected error:', err);
  }
}

/**
 * Extract usage from OpenAI completion response and log it
 */
export async function logOpenAiUsage(
  completion: any,
  userId: string,
  task: string
): Promise<void> {
  const model = completion.model || 'unknown';
  const usage = completion.usage;
  
  if (!usage) {
    console.warn('[ai_usage_logger] No usage data in completion response');
    return;
  }
  
  await logAiUsage({
    userId,
    model,
    task,
    inputTokens: usage.prompt_tokens || 0,
    outputTokens: usage.completion_tokens || 0,
  });
}

/**
 * Extract usage from Anthropic message response and log it
 */
export async function logAnthropicUsage(
  message: any,
  userId: string,
  task: string
): Promise<void> {
  const model = message.model || 'unknown';
  const usage = message.usage;
  
  if (!usage) {
    console.warn('[ai_usage_logger] No usage data in message response');
    return;
  }
  
  await logAiUsage({
    userId,
    model,
    task,
    inputTokens: usage.input_tokens || 0,
    outputTokens: usage.output_tokens || 0,
  });
}
