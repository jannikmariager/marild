import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabaseServer";

const ALLOWED_METHODS = "GET,OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type, Supabase-Access-Token";

function applyCors(response: NextResponse, request: NextRequest) {
  const origin = request.headers.get("origin") ?? "*";
  response.headers.set("Access-Control-Allow-Origin", origin || "*");
  if (origin) {
    response.headers.set("Vary", "Origin");
  }
  response.headers.set("Access-Control-Allow-Methods", ALLOWED_METHODS);
  response.headers.set("Access-Control-Allow-Headers", ALLOWED_HEADERS);
  response.headers.set("Access-Control-Max-Age", "600");
  return response;
}

export async function OPTIONS(request: NextRequest) {
  return applyCors(new NextResponse(null, { status: 204 }), request);
}

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get("limit") || "5", 10);
    const category = searchParams.get("category") || "all";

    // Try cached news first
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: news, error } = await supabase
      .from("news_cache")
      .select("*")
      .eq("category", category === "all" ? category : category.toLowerCase())
      .gte("published_at", cutoff)
      .order("published_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.warn("[news/headlines] cache query failed:", error.message);
    }

    const items = (news || []).map((item) => ({
      id: item.id ?? item.url ?? item.title,
      title: item.title || item.headline,
      source: item.source || "Market News",
      published_at: item.published_at,
      time_ago: null,
      sentiment: item.sentiment || "neutral",
      url: item.url || item.link || "#",
    }));

    return applyCors(NextResponse.json({ articles: items, total: items.length }), request);
  } catch (err: any) {
    console.error("[news/headlines] unexpected error:", err);
    // Return graceful empty payload to keep UI from erroring
    return applyCors(
      NextResponse.json({ articles: [], total: 0, error: "news unavailable" }, { status: 200 }),
      request,
    );
  }
}
