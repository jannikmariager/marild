import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  computeCorrectionRisk,
  saveRiskSnapshot,
} from "../_shared/correctionRiskEngine.ts";

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
    console.log("Starting daily correction risk computation...");

    // Compute risk from market data
    const { snapshot, factors } = await computeCorrectionRisk();

    console.log("Risk computed:", {
      score: snapshot.risk_score,
      label: snapshot.risk_label,
      factorCount: factors.length,
    });

    // Save to database
    const { snapshotId } = await saveRiskSnapshot(snapshot, factors);

    console.log("Risk snapshot saved:", { snapshotId });

    return new Response(
      JSON.stringify({
        success: true,
        snapshot_id: snapshotId,
        risk_score: snapshot.risk_score,
        risk_label: snapshot.risk_label,
        summary: snapshot.summary,
        as_of_date: snapshot.as_of_date,
        factors_count: factors.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Correction risk daily computation error:", error);

    return new Response(
      JSON.stringify({
        error: "COMPUTATION_ERROR",
        message: error.message || "Failed to compute correction risk",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
