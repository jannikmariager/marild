import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MASSIVE_API_KEY = Deno.env.get("MASSIVE_API_KEY") || Deno.env.get("POLYGON_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!MASSIVE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing required environment variables");
  throw new Error("MASSIVE_API_KEY, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are required");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Write JSONL to disk
 */
async function appendJSONL(path: string, rows: any[]) {
  const file = await Deno.open(path, { write: true, append: true, create: true });
  const encoder = new TextEncoder();
  for (const row of rows) {
    const line = JSON.stringify(row) + "\n";
    await file.write(encoder.encode(line));
  }
  file.close();
}

/**
 * Fetch and stream Massive/Polygon OHLC data with cursor pagination
 * 
 * Polygon.io (now Massive) API endpoint:
 * https://api.polygon.io/v2/aggs/ticker/{symbol}/range/{multiplier}/{timespan}/{from}/{to}
 */
async function fetchMassivePaginated(
  symbol: string,
  interval: string,
  from: string,
  to: string,
  outPath: string
): Promise<number> {
  // Parse interval format: "5/minute" or "1/hour" or "1/day"
  const [multiplier, timespan] = interval.split("/");
  
  let url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${MASSIVE_API_KEY}`;
  let totalBars = 0;
  let page = 1;

  while (url) {
    console.log(`[${symbol}] Page ${page}: Fetching...`);

    const res = await fetch(url);

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[${symbol}] Error ${res.status}: ${errorText}`);
      throw new Error(`Polygon API error ${res.status}: ${errorText}`);
    }

    const json = await res.json();

    if (!json?.results || json.results.length === 0) {
      console.log(`[${symbol}] No more results`);
      break;
    }

    // Write to JSONL on disk
    await appendJSONL(outPath, json.results);
    totalBars += json.results.length;
    console.log(`[${symbol}] Page ${page}: Got ${json.results.length} bars (total: ${totalBars})`);

    // Cursor pagination - Polygon's next_url doesn't include API key
    url = json?.next_url ? `${json.next_url}&apiKey=${MASSIVE_API_KEY}` : null;
    page++;

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return totalBars;
}

/**
 * Upload JSONL file to Supabase Storage
 */
async function uploadToStorage(
  symbol: string,
  interval: string,
  localPath: string
): Promise<string> {
  const fileBytes = await Deno.readFile(localPath);
  
  // Clean interval for path: "5/minute" -> "5m"
  const cleanInterval = interval.replace("/minute", "m")
    .replace("/hour", "h")
    .replace("/day", "d");
  
  const remotePath = `${symbol}/${cleanInterval}.jsonl`;

  console.log(`[${symbol}] Uploading ${fileBytes.length} bytes to ohlc-cache-v2/${remotePath}`);

  const { error } = await supabase.storage
    .from("ohlc-cache-v2")
    .upload(remotePath, fileBytes, {
      contentType: "application/x-ndjson",
      upsert: true
    });

  if (error) {
    console.error(`[${symbol}] Upload error:`, error);
    throw error;
  }

  const { data: urlData } = supabase.storage
    .from("ohlc-cache-v2")
    .getPublicUrl(remotePath);

  return urlData.publicUrl;
}

/**
 * Main handler
 */
serve(async (req) => {
  try {
    const { tickers, interval, from, to } = await req.json();

    // Validation
    if (!tickers || !Array.isArray(tickers) || tickers.length === 0) {
      return new Response(
        JSON.stringify({ error: "tickers[] array required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!interval || !from || !to) {
      return new Response(
        JSON.stringify({ error: "interval, from, and to are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📡 Starting bulk download for ${tickers.length} tickers`);
    console.log(`   Interval: ${interval}`);
    console.log(`   Range: ${from} to ${to}`);

    const results: any[] = [];
    const startTime = Date.now();

    for (const symbol of tickers) {
      const outPath = `/tmp/${symbol}_${interval.replace("/", "_")}.jsonl`;
      
      // Remove existing file if present
      try {
        await Deno.remove(outPath);
      } catch (_) {
        // Ignore if file doesn't exist
      }

      console.log(`\n[${symbol}] Starting download...`);

      try {
        const totalBars = await fetchMassivePaginated(symbol, interval, from, to, outPath);

        console.log(`[${symbol}] Uploading to Storage...`);
        const url = await uploadToStorage(symbol, interval, outPath);

        results.push({
          symbol,
          interval,
          bars: totalBars,
          file_url: url,
          status: "success"
        });

        console.log(`[${symbol}] ✅ Complete: ${totalBars} bars`);

      } catch (error) {
        console.error(`[${symbol}] ❌ Failed:`, error.message);
        results.push({
          symbol,
          interval,
          bars: 0,
          error: error.message,
          status: "error"
        });
      }

      // Cleanup temp file
      try {
        await Deno.remove(outPath);
      } catch (_) {
        // Ignore
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    const totalBars = results.reduce((sum, r) => sum + (r.bars || 0), 0);
    const successful = results.filter(r => r.status === "success").length;

    console.log(`\n✅ Bulk download complete in ${duration}s`);
    console.log(`   Successful: ${successful}/${tickers.length}`);
    console.log(`   Total bars: ${totalBars.toLocaleString()}`);

    return new Response(
      JSON.stringify({
        status: "complete",
        count: results.length,
        successful,
        total_bars: totalBars,
        duration_seconds: parseFloat(duration),
        results
      }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("❌ ERROR:", err);
    return new Response(
      JSON.stringify({ error: err.message, stack: err.stack }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
