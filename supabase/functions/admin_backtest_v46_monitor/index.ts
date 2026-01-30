// admin_backtest_v46_monitor
//
// This function is intended to be run on a Supabase cron (e.g. daily).
// It checks the system_alerts table for the most recent
//   type = 'info', message = 'backtest_v46_heartbeat'
// inserted by the backtest_v46_heartbeat function, and if the heartbeat
// is older than a threshold, it posts an alert to the admin-alerts Discord
// channel using the shared admin_alerts helper.

import { postAdminAlert, AlertSeverity } from "../_admin_shared/admin_alerts.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface HeartbeatRow {
  timestamp: string;
}

Deno.serve(async (req) => {
  if (!SUPABASE_URL || !SRK) {
    console.error("[admin_backtest_v46_monitor] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return new Response("Missing config", { status: 500 });
  }

  const urlObj = new URL(req.url);
  const force = urlObj.searchParams.get("force") === "1";

  // If force=1, immediately send a test alert to Discord and return.
  if (force) {
    await postAdminAlert({
      severity: AlertSeverity.CRITICAL,
      function_name: "admin_backtest_v46_monitor(force)",
      error_message: "Forced V4.6 backtest alert test",
      details: "Triggered with ?force=1 query param for testing.",
    });
    return new Response(
      JSON.stringify({ status: "forced_alert_sent" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/system_alerts?type=eq.info&message=eq.backtest_v46_heartbeat&order=timestamp.desc&limit=1`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${SRK}`,
        apikey: SRK,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "<no body>");
      console.error("[admin_backtest_v46_monitor] Failed to query system_alerts:", res.status, txt);
      await postAdminAlert({
        severity: AlertSeverity.ERROR,
        function_name: "admin_backtest_v46_monitor",
        error_message: `Failed to query system_alerts: ${res.status}`,
        details: txt,
      });
      return new Response("Query failed", { status: 500 });
    }

    const rows: HeartbeatRow[] = await res.json();
    const now = new Date();

    if (!rows || rows.length === 0) {
      console.warn("[admin_backtest_v46_monitor] No heartbeat rows found");
      await postAdminAlert({
        severity: AlertSeverity.CRITICAL,
        function_name: "admin_backtest_v46_monitor",
        error_message: "No V4.6 backtest heartbeat found in system_alerts",
        details: "Expected at least one backtest_v46_heartbeat entry.",
      });
      return new Response(JSON.stringify({ status: "no_heartbeat" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const latestTs = new Date(rows[0].timestamp);
    const diffMs = now.getTime() - latestTs.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // Consider stale if we haven't seen a heartbeat in > 36 hours
    const isStale = diffHours > 36;

    if (isStale) {
      console.error(
        "[admin_backtest_v46_monitor] Heartbeat is stale:",
        latestTs.toISOString(),
        `(${diffHours.toFixed(2)}h ago)`,
      );
      await postAdminAlert({
        severity: AlertSeverity.CRITICAL,
        function_name: "backtest_v46_daily_runner",
        error_message: "No successful V4.6 backtest run detected in the last 36 hours",
        details: `Last heartbeat at ${latestTs.toISOString()} (${diffHours.toFixed(2)} hours ago).`,
      });
    } else {
      console.log(
        "[admin_backtest_v46_monitor] Heartbeat OK – last at",
        latestTs.toISOString(),
        `(${diffHours.toFixed(2)}h ago)`,
      );
    }

    return new Response(
      JSON.stringify({
        status: isStale ? "stale" : "ok",
        last_heartbeat: latestTs.toISOString(),
        age_hours: diffHours,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[admin_backtest_v46_monitor] Exception:", err);
    await postAdminAlert({
      severity: AlertSeverity.ERROR,
      function_name: "admin_backtest_v46_monitor",
      error_message: "Exception while checking heartbeat",
      details: String(err),
    });
    return new Response("Exception", { status: 500 });
  }
});
