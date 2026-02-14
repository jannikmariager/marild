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

    const json = (payload: unknown) => {
      const res = NextResponse.json(payload);
      // Let Vercel edge cache successful reads briefly to reduce latency/cold starts.
      res.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=600");
      return applyCors(res, request);
    };

    // Try cached news first (prefer recent), but fall back to latest available if cache is stale.
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const buildBaseQuery = () => {
      let query = supabase
        .from("news_cache")
        .select("*")
        .order("published_at", { ascending: false })
        .limit(limit);

      // "all" means no category filter. Otherwise filter by lowercased category.
      if (category !== "all") {
        query = query.eq("category", category.toLowerCase());
      }

      return query;
    };

    // 1) Prefer recent rows.
    const { data: recentNews, error } = await buildBaseQuery().gte("published_at", cutoff);

    // 2) If we have some recent rows, keep them but fill the remainder with older cached rows.
    // Otherwise, return the latest cached rows regardless of age.
    let baseNews = null as any[] | null;
    if (recentNews && recentNews.length > 0) {
      if (recentNews.length >= limit) {
        baseNews = recentNews;
      } else {
        const { data: anyAgeNews } = await buildBaseQuery();
        const merged = [...recentNews, ...(anyAgeNews || [])];
        const seen = new Set<string>();
        baseNews = merged.filter((item) => {
          const key = item.url ?? item.link ?? item.id ?? item.title ?? item.headline;
          if (!key) return false;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }).slice(0, limit);
      }
    } else {
      baseNews = error ? null : (await buildBaseQuery()).data;
    }

    if (error) {
      console.warn("[news/headlines] cache query failed:", error.message);
    }

    const cacheSparse = !baseNews || baseNews.length < Math.min(limit, 10);

    // If cache is empty/sparse, top up via Edge Function.
    // This keeps the UI alive even if scheduled ingestion isn't running.
    if (cacheSparse && !error) {
      try {
        const { data, error: fnError } = await supabase.functions.invoke("news_sentiment_analyzer", {
          body: { symbol: null, limit },
        });

        if (!fnError && data && Array.isArray((data as any).articles)) {
          const fresh = (data as any).articles as any[];
          const freshItems = fresh.map((item) => ({
            id: item.url ?? item.headline,
            title: item.headline,
            source: item.source || "Market News",
            published_at: item.published_at,
            time_ago: null,
            sentiment: (item.sentiment_label || "neutral").toLowerCase(),
            url: item.url || "#",
          }));

          const cachedItems = (baseNews || []).map((item) => ({
            id: item.id ?? item.url ?? item.title,
            title: item.title || item.headline,
            source: item.source || "Market News",
            published_at: item.published_at,
            time_ago: null,
            sentiment: item.sentiment || "neutral",
            url: item.url || item.link || "#",
          }));

          const merged = [...cachedItems, ...freshItems];
          const seen = new Set<string>();
          const deduped = merged.filter((item) => {
            const key = (item.url && item.url !== "#") ? item.url : item.id;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });

          return json({ articles: deduped.slice(0, limit), total: deduped.length });
        }
      } catch (err) {
        console.warn("[news/headlines] on-demand fetch failed");
      }
    }

    const items = (baseNews || []).map((item) => ({
      id: item.id ?? item.url ?? item.title,
      title: item.title || item.headline,
      source: item.source || "Market News",
      published_at: item.published_at,
      time_ago: null,
      sentiment: item.sentiment || "neutral",
      url: item.url || item.link || "#",
    }));

    return json({ articles: items, total: items.length });
  } catch (err: any) {
    console.error("[news/headlines] unexpected error:", err);
    // Return graceful empty payload to keep UI from erroring
    return applyCors(
      NextResponse.json({ articles: [], total: 0, error: "news unavailable" }, { status: 200 }),
      request,
    );
  }
}
