// Health check / self-test function
// Tests connectivity to all external services and databases
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

interface HealthStatus {
  service: string;
  status: "ok" | "error";
  message?: string;
}

Deno.serve(async (req) => {
  const results: HealthStatus[] = [];

  // Test 1: Supabase connectivity
  try {
    const { data, error } = await supabase
      .from("user_profile")
      .select("count")
      .limit(1);
    results.push({
      service: "supabase",
      status: error ? "error" : "ok",
      message: error?.message,
    });
  } catch (err) {
    results.push({
      service: "supabase",
      status: "error",
      message: String(err),
    });
  }

  // Test 2: OpenAI connectivity
  const hasOpenAiKey = !!Deno.env.get("OPENAI_API_KEY");
  results.push({
    service: "openai",
    status: hasOpenAiKey ? "ok" : "error",
    message: hasOpenAiKey ? "API key configured" : "API key missing",
  });

  // Test 3: Discord webhook
  const hasDiscord = !!Deno.env.get("DISCORD_ALERT_WEBHOOK_URL");
  results.push({
    service: "discord",
    status: hasDiscord ? "ok" : "error",
    message: hasDiscord ? "Webhook configured" : "Webhook URL missing",
  });

  // Test 4: Database tables exist
  const tables = [
    "ai_signals",
    "ai_token_usage",
    "data_source_costs",
    "system_alerts",
  ];
  for (const table of tables) {
    try {
      await supabase.from(table).select("*").limit(1);
      results.push({ service: `table_${table}`, status: "ok" });
    } catch (err) {
      results.push({
        service: `table_${table}`,
        status: "error",
        message: String(err),
      });
    }
  }

  const allOk = results.every((r) => r.status === "ok");

  return new Response(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      overall_status: allOk ? "healthy" : "degraded",
      checks: results,
    }),
    {
      status: allOk ? 200 : 207,
      headers: { "Content-Type": "application/json" },
    }
  );
});
