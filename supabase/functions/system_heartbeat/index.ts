import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendDiscordAlert, type AlertSeverity } from "../_admin_shared/discord_helper.ts";
import { getCryptoLatest } from "../_shared/alpaca_crypto.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SRK = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

type CheckResult = { name: string; ok: boolean; details?: string };

async function runChecks() {
  const supabase = createClient(SUPABASE_URL, SRK);
  const results: CheckResult[] = [];

  // Engines
  const { data: primary, error: primaryErr } = await supabase
    .from("engine_versions")
    .select("engine_key, engine_version")
    .eq("run_mode", "PRIMARY")
    .eq("is_enabled", true);
  results.push({
    name: "primary_engines",
    ok: !primaryErr && !!primary && primary.length > 0,
    details: primaryErr ? primaryErr.message : `count=${primary?.length ?? 0}`,
  });

  const { data: shadow, error: shadowErr } = await supabase
    .from("engine_versions")
    .select("engine_key, engine_version")
    .eq("run_mode", "SHADOW")
    .eq("is_enabled", true);
  results.push({
    name: "shadow_engines",
    ok: !shadowErr && !!shadow && shadow.length > 0,
    details: shadowErr ? shadowErr.message : `count=${shadow?.length ?? 0}`,
  });

  // Cron jobs of interest
  const cronNames = [
    "update_market_quotes_10min",
    "model_portfolio_manager_market_hours",
    "crypto_shadow_every_5min",
    "scalp_signal_executor_run",
    "scalp_position_monitor_run",
  ];
  const { data: cronRows, error: cronErr } = await supabase
    .from("cron_jobs")
    .select("jobname");
  for (const name of cronNames) {
    const ok = !cronErr && !!cronRows?.some((r: any) => r.jobname === name);
    results.push({ name: `cron_${name}`, ok, details: cronErr ? cronErr.message : undefined });
  }

  // Signals freshness (ai_signals max created_at within 3h)
  const { data: maxSignalTs, error: signalsErr } = await supabase
    .from("ai_signals")
    .select("created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let signalsOk = false;
  if (!signalsErr && maxSignalTs?.created_at) {
    const ageMs = Date.now() - new Date(maxSignalTs.created_at).getTime();
    signalsOk = ageMs <= 3 * 60 * 60 * 1000; // 3h
    results.push({
      name: "signals_fresh",
      ok: signalsOk,
      details: `age_minutes=${Math.round(ageMs / 60000)}`,
    });
  } else {
    results.push({
      name: "signals_fresh",
      ok: false,
      details: signalsErr ? signalsErr.message : "no signals rows",
    });
  }

  // Alpaca crypto reachability
  let alpacaOk = false;
  try {
    const q = await getCryptoLatest("BTC/USD");
    alpacaOk = !!q?.mid;
  } catch (err) {
    results.push({ name: "alpaca_crypto", ok: false, details: String(err) });
  }
  if (alpacaOk) results.push({ name: "alpaca_crypto", ok: true, details: "BTC/USD mid ok" });

  return results;
}

function summarize(results: CheckResult[]) {
  const failures = results.filter((r) => !r.ok);
  const ok = failures.length === 0;
  const severity: AlertSeverity = ok ? "INFO" : failures.length > 2 ? "CRITICAL" : "WARN";
  const lines = results.map((r) => `• ${r.name}: ${r.ok ? "OK" : "FAIL"}${r.details ? ` (${r.details})` : ""}`);
  return { ok, severity, message: lines.join("\n") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200 });
  if (!SUPABASE_URL || !SRK) return new Response("Missing config", { status: 500 });

  try {
    const results = await runChecks();
    const summary = summarize(results);
    await sendDiscordAlert({
      severity: summary.severity,
      title: summary.ok ? "All systems OK" : "System checks failing",
      message: summary.message,
    });
    return new Response(JSON.stringify({ ok: summary.ok, results }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    await sendDiscordAlert({
      severity: "CRITICAL",
      title: "Heartbeat exception",
      message: String(err),
    });
    return new Response("Exception", { status: 500 });
  }
});
