import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { sendDiscordAlert } from "../_admin_shared/discord_helper.ts";

const FUNCTION_NAME = "monitor_portfolio_state";

type Strategy = "DAYTRADE" | "SWING";

function isMarketHoursUtc(now: Date): boolean {
  // US equities regular session: 09:30–16:00 ET
  // Approx in UTC (standard vs DST varies). We use a generous UTC window that covers both:
  // 13:25–21:10 UTC (covers 09:25–17:10 ET) on weekdays.
  const day = now.getUTCDay(); // 0 Sun ... 6 Sat
  if (day === 0 || day === 6) return false;

  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const start = 13 * 60 + 25;
  const end = 21 * 60 + 10;
  return minutes >= start && minutes <= end;
}

async function getLatestTimestampByStrategy(supabase: any, strategy: Strategy) {
  const { data, error } = await supabase
    .from("live_portfolio_state")
    .select("timestamp")
    .eq("strategy", strategy)
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.timestamp ? new Date(data.timestamp) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const now = new Date();

    // Only alert during market hours; outside market hours we still return status.
    const inMarketHours = isMarketHoursUtc(now);

    const latestDaytrade = await getLatestTimestampByStrategy(supabase, "DAYTRADE");
    const latestSwing = await getLatestTimestampByStrategy(supabase, "SWING");

    const ageMinutes = (ts: Date | null) => {
      if (!ts) return null;
      return Math.floor((now.getTime() - ts.getTime()) / 60000);
    };

    const ageDaytrade = ageMinutes(latestDaytrade);
    const ageSwing = ageMinutes(latestSwing);

    // Threshold: snapshots should update at least every 10 minutes (cron runs every 5 minutes).
    const STALE_THRESHOLD_MIN = 15;

    const stale: Array<{ strategy: Strategy; age_min: number | null; latest_ts: string | null }> = [];

    if (ageDaytrade === null || ageDaytrade >= STALE_THRESHOLD_MIN) {
      stale.push({
        strategy: "DAYTRADE",
        age_min: ageDaytrade,
        latest_ts: latestDaytrade ? latestDaytrade.toISOString() : null,
      });
    }

    if (ageSwing === null || ageSwing >= STALE_THRESHOLD_MIN) {
      stale.push({
        strategy: "SWING",
        age_min: ageSwing,
        latest_ts: latestSwing ? latestSwing.toISOString() : null,
      });
    }

    if (inMarketHours && stale.length > 0) {
      await sendDiscordAlert({
        severity: "WARN",
        title: "Live portfolio state stale",
        message:
          `live_portfolio_state has not updated recently (threshold ${STALE_THRESHOLD_MIN}m). ` +
          `This can cause the dashboard equity to freeze and sizing to use stale equity until the next run succeeds.`,
        context: {
          now_utc: now.toISOString(),
          daytrade_latest_utc: latestDaytrade ? latestDaytrade.toISOString() : "null",
          daytrade_age_min: ageDaytrade === null ? "null" : String(ageDaytrade),
          swing_latest_utc: latestSwing ? latestSwing.toISOString() : "null",
          swing_age_min: ageSwing === null ? "null" : String(ageSwing),
          function: FUNCTION_NAME,
        },
      });
    }

    return new Response(
      JSON.stringify({
        ok: true,
        now_utc: now.toISOString(),
        in_market_hours_utc_window: inMarketHours,
        latest: {
          DAYTRADE: latestDaytrade ? latestDaytrade.toISOString() : null,
          SWING: latestSwing ? latestSwing.toISOString() : null,
        },
        age_min: {
          DAYTRADE: ageDaytrade,
          SWING: ageSwing,
        },
        stale,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] Error:`, error);
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
