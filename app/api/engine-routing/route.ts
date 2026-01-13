import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "edge";

type EngineRoutingResponse = {
  engineVersion: string;
  mode: string;
  timeframe: string;
  enabled: boolean;
};

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ticker = searchParams.get("ticker")?.toUpperCase();
  const mode = (searchParams.get("mode") ?? "SWING").toUpperCase();
  const timeframe = searchParams.get("timeframe") ?? "4H";

  if (!ticker) {
    return NextResponse.json({ error: "Missing ticker parameter" }, { status: 400 });
  }

  // Validate mode
  if (!["DAYTRADER", "SWING"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode. Must be DAYTRADER or SWING" }, { status: 400 });
  }

  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("engine_routing")
      .select("engine_version, mode, timeframe, enabled")
      .eq("ticker", ticker)
      .eq("mode", mode)
      .eq("timeframe", timeframe)
      .eq("enabled", true)
      .maybeSingle();

    if (error) {
      console.error("[engine-routing] Database error:", error);
      return NextResponse.json({ error: "Routing lookup failed" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: "No routing found for this ticker/mode/timeframe" }, { status: 404 });
    }

    const response: EngineRoutingResponse = {
      engineVersion: data.engine_version,
      mode: data.mode,
      timeframe: data.timeframe,
      enabled: data.enabled,
    };

    return NextResponse.json(response, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    console.error("[engine-routing] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Get all routing for a ticker (all modes and timeframes)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { ticker } = body;

    if (!ticker) {
      return NextResponse.json({ error: "Missing ticker" }, { status: 400 });
    }

    const supabase = await createClient();

    const { data, error } = await supabase
      .from("engine_routing")
      .select("engine_version, mode, timeframe, enabled")
      .eq("ticker", ticker.toUpperCase())
      .eq("enabled", true)
      .order("mode", { ascending: true })
      .order("timeframe", { ascending: true });

    if (error) {
      console.error("[engine-routing] Database error:", error);
      return NextResponse.json({ error: "Routing lookup failed" }, { status: 500 });
    }

    return NextResponse.json(
      {
        ticker: ticker.toUpperCase(),
        routing: data || [],
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } catch (error) {
    console.error("[engine-routing] Unexpected error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
