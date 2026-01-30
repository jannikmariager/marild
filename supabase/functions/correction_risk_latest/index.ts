import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSubscriptionStatusFromRequest, hasProAccess } from "../_shared/subscription_checker.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase admin client
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check DEV_FORCE_PRO override
    const devForcePro = Deno.env.get("DEV_FORCE_PRO") === "true";
    let isProOrTrial = devForcePro;

    if (!devForcePro) {
      // Check PRO access using shared subscription checker
      try {
        const subscriptionStatus = await getSubscriptionStatusFromRequest(supabaseAdmin, req);
        isProOrTrial = hasProAccess(subscriptionStatus);
        console.log("Access check:", { tier: subscriptionStatus.tier, has_access: subscriptionStatus.has_access, isProOrTrial });
      } catch (subError) {
        console.error("Subscription check error:", subError);
        // Continue with isProOrTrial = false if check fails
      }
    } else {
      console.log("DEV_FORCE_PRO enabled - granting access");
    }

    // Fetch latest correction risk snapshot
    const { data: snapshot, error: snapshotError } = await supabaseAdmin
      .from("correction_risk_snapshots")
      .select("*")
      .order("as_of_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (snapshotError) {
      throw new Error(`Failed to fetch snapshot: ${snapshotError.message}`);
    }

    if (!snapshot) {
      return new Response(
        JSON.stringify({
          error: "NO_DATA",
          message: "No correction risk data available yet",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Generate deterministic trend data (last 7 days)
    // Pattern: gradually improving (risk decreasing) for scores < 50
    // Pattern: gradually worsening (risk increasing) for scores >= 50
    const generateTrend = () => {
      const currentScore = snapshot.risk_score / 100;
      const isImproving = currentScore < 0.50;
      
      return Array.from({ length: 7 }, (_, i) => {
        // Deterministic tiny variance based only on index (no randomness, no UUID math)
        const smallVariance = (i % 5) * 0.002; // 0.000, 0.002, 0.004, 0.006, 0.008

        let trendValue: number;
        if (isImproving) {
          // Improving trend: earlier values were higher (more risky)
          trendValue = currentScore + ((6 - i) * 0.015) + smallVariance;
        } else {
          // Worsening trend: earlier values were lower (less risky)
          trendValue = currentScore - ((6 - i) * 0.015) + smallVariance;
        }

        // Clamp to [0,1]
        trendValue = Math.max(0, Math.min(1, trendValue));
        return Number(trendValue.toFixed(4));
      });
    };

    // If locked, return minimal data
    if (!isProOrTrial) {
      return new Response(
        JSON.stringify({
          risk_score: snapshot.risk_score,
          risk_label: snapshot.risk_label,
          summary: "Unlock AI Correction Risk analysis with Pro.",
          as_of_date: snapshot.as_of_date,
          updated_at: snapshot.updated_at,
          trend: generateTrend(),
          key_drivers: [],
          factors: [],
          access: {
            is_pro_or_trial: false,
            is_locked: true,
          },
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch factors for Pro/trial users
    const { data: factors, error: factorsError } = await supabaseAdmin
      .from("correction_risk_factors")
      .select("*")
      .eq("snapshot_id", snapshot.id)
      .order("contribution", { ascending: false });

    if (factorsError) {
      throw new Error(`Failed to fetch factors: ${factorsError.message}`);
    }

    // Map factors to key_drivers format
    const keyDrivers = factors.slice(0, 5).map((f) => ({
      label: f.factor_label,
      status: f.status,
    }));

    // Return full data
    return new Response(
      JSON.stringify({
        risk_score: snapshot.risk_score,
        risk_label: snapshot.risk_label,
        summary: snapshot.summary,
        as_of_date: snapshot.as_of_date,
        updated_at: snapshot.updated_at,
        trend: generateTrend(),
        key_drivers: keyDrivers,
        factors: factors.map((f) => ({
          factor_key: f.factor_key,
          factor_label: f.factor_label,
          score: f.score,
          weight: f.weight,
          contribution: f.contribution,
          status: f.status,
          reasoning: f.reasoning,
        })),
        access: {
          is_pro_or_trial: true,
          is_locked: false,
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Correction risk latest error:", error);

    return new Response(
      JSON.stringify({
        error: "SERVER_ERROR",
        message: error.message || "Failed to fetch correction risk data",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
