// Minimal test function to verify basic functionality
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    
    // Return mock result immediately
    const result = {
      action: body.action || "test",
      generatedAt: new Date().toISOString(),
      headline: "Test Action Successful",
      summary: "This is a test response from the Edge Function. If you see this, the basic function works!",
      insights: [
        {
          id: "test-1",
          title: "Test Insight",
          body: "This is a test insight to verify the response structure.",
          severity: "info",
          tags: ["test"],
        }
      ],
      disclaimer: "This is a test response.",
    };

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[test_quick_action] Error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
