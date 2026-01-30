/**
 * Test AI Logging
 * Simple test to verify ai_usage_logs table is being written to
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';
import OpenAI from 'https://esm.sh/openai@4.20.1';
import { logOpenAiUsage } from '../_shared/ai_usage_logger.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not set');
    }

    const openai = new OpenAI({ apiKey: openaiKey });

    console.log('[test_ai_logging] Making test OpenAI call...');

    // Make a minimal OpenAI call
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say "test successful" in 3 words or less.' },
      ],
      max_tokens: 10,
      temperature: 0.3,
    });

    const response = completion.choices[0]?.message?.content || 'No response';

    console.log('[test_ai_logging] OpenAI response:', response);
    console.log('[test_ai_logging] Usage:', completion.usage);

    // Log usage
    await logOpenAiUsage(completion, 'system', 'test_logging');

    console.log('[test_ai_logging] Usage logged successfully');

    // Check if it was written
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: recentLogs, error } = await supabase
      .from('ai_usage_logs')
      .select('*')
      .eq('task', 'test_logging')
      .order('created_at', { ascending: false })
      .limit(1);

    if (error) {
      console.error('[test_ai_logging] Error reading logs:', error);
    } else {
      console.log('[test_ai_logging] Recent log entry:', recentLogs?.[0]);
    }

    return new Response(
      JSON.stringify({
        success: true,
        ai_response: response,
        usage: completion.usage,
        log_written: !error,
        log_entry: recentLogs?.[0],
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('[test_ai_logging] Error:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
