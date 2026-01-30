// Edge Function: Detect anomalies in system metrics
// Endpoint: POST /functions/v1/admin_anomaly_detector
// Purpose: Monitor crashes, AI costs, errors and alert if thresholds exceeded

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { sendDiscordAlert } from "../_admin_shared/discord_helper.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  try {
    // Check crash rate
    const { data: crashes } = await supabase
      .from("crashlogs")
      .select("*", { count: "exact" })
      .gte("timestamp", new Date(Date.now() - 3600000).toISOString());

    if ((crashes?.length || 0) > 10) {
      await supabase.from("system_alerts").insert({
        type: "anomaly",
        message: `High crash rate detected: ${crashes?.length} in last hour`,
        metadata: { crashes: crashes?.length, threshold: 10 },
      });

      await sendDiscordAlert({
        severity: "CRITICAL",
        title: "High Crash Rate",
        message: `${crashes?.length} crashes in last hour`,
      });
    }

    // Check AI costs (daily)
    const { data: costs } = await supabase
      .from("ai_token_usage")
      .select("total_cost_usd", { count: "exact" })
      .gte("created_at", new Date(Date.now() - 86400000).toISOString());

    const totalCost = costs?.reduce((sum, row) => sum + (row.total_cost_usd || 0), 0) || 0;
    if (totalCost > 100) {
      await sendDiscordAlert({
        severity: "WARN",
        title: "High Daily AI Cost",
        message: `$${totalCost.toFixed(2)} spent on AI today`,
      });
    }

    // Check error rate
    const { data: errors } = await supabase
      .from("system_alerts")
      .select("*", { count: "exact" })
      .eq("type", "error")
      .gte("timestamp", new Date(Date.now() - 3600000).toISOString());

    if ((errors?.length || 0) > 20) {
      await sendDiscordAlert({
        severity: "WARN",
        title: "Error Spike",
        message: `${errors?.length} errors in last hour`,
      });
    }

    return new Response(JSON.stringify({ status: "ok", checks_run: 3 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Anomaly detection error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
