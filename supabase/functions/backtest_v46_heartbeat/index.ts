// backtest_v46_heartbeat
// Simple heartbeat endpoint called by the local Mac mini after
// the daily V4.6 backtest run completes successfully.
//
// It records a row in system_alerts (type = 'info', message = 'backtest_v46_heartbeat')
// which can be monitored by a separate admin function.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!SUPABASE_URL || !SRK) {
    console.error("[backtest_v46_heartbeat] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return new Response("Missing config", { status: 500 });
  }

  const now = new Date().toISOString();

  try {
    const body = await req.text().catch(() => "{}");
    let metadata: Record<string, unknown>;
    try {
      metadata = body ? JSON.parse(body) : {};
    } catch {
      metadata = {};
    }

    metadata = {
      ...metadata,
      source: "mac-mini-v46",
      completed_at: now,
    };

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/system_alerts`, {
      method: "POST",
      headers: {
        // Use service role JWT as both Bearer and apikey so RLS sees auth.role() = 'service_role'
        Authorization: `Bearer ${SRK}`,
        apikey: SRK,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        type: "info",
        message: "backtest_v46_heartbeat",
        metadata,
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "<no body>");
      console.error("[backtest_v46_heartbeat] Failed to insert system_alert:", resp.status, txt);
      return new Response(`Insert failed: ${resp.status} ${txt}`, { status: 500 });
    }

    console.log("[backtest_v46_heartbeat] Recorded heartbeat at", now);
    return new Response(JSON.stringify({ status: "ok", timestamp: now }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[backtest_v46_heartbeat] Exception:", err);
    return new Response("Exception", { status: 500 });
  }
});
