import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MASSIVE_API_KEY = Deno.env.get("MASSIVE_API_KEY") || Deno.env.get("POLYGON_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!MASSIVE_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("Missing required environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Stream append JSON lines to disk
 */
async function appendJSONL(path: string, rows: any[]) {
  const file = await Deno.open(path, { write: true, create: true, append: true });
  const enc = new TextEncoder();
  for (const r of rows) {
    await file.write(enc.encode(JSON.stringify(r) + "\n"));
  }
  file.close();
}

/**
 * Paginated Massive downloader with cursor pagination
 */
async function fetchMassivePaginated(
  symbol: string,
  interval: string,
  from: string,
  to: string,
  localPath: string
): Promise<number> {
  // Parse interval: "1/hour" -> multiplier=1, timespan=hour
  const [multiplier, timespan] = interval.split("/");
  
  let url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${MASSIVE_API_KEY}`;
  let totalBars = 0;
  let page = 1;

  while (url) {
    console.log(`[${symbol}] ${interval} Page ${page}`);
    
    const res = await fetch(url);

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[${symbol}] ERROR ${res.status}: ${errorText}`);
      break;
    }

    const json = await res.json();
    if (!json?.results?.length) {
      console.log(`[${symbol}] ${interval} - No more data`);
      break;
    }

    await appendJSONL(localPath, json.results);
    totalBars += json.results.length;
    console.log(`[${symbol}] ${interval} Page ${page}: ${json.results.length} bars (total: ${totalBars})`);

    // Handle pagination - Polygon doesn't include API key in next_url
    url = json?.next_url ? `${json.next_url}&apiKey=${MASSIVE_API_KEY}` : null;
    page++;

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return totalBars;
}

/**
 * Upload finished JSONL to Supabase Storage
 */
async function uploadToStorage(
  symbol: string,
  interval: string,
  localPath: string
): Promise<string> {
  const data = await Deno.readFile(localPath);
  
  // Clean interval name for path: "1/hour" -> "1h"
  const cleanInterval = interval.replace("/hour", "h")
    .replace("/day", "d")
    .replace("/week", "w")
    .replace("/month", "mo");
  
  const remotePath = `${symbol}/${cleanInterval}.jsonl`;

  console.log(`[${symbol}] Uploading ${data.length} bytes to ${remotePath}`);

  const { error } = await supabase.storage
    .from("ohlc-cache-v2")
    .upload(remotePath, data, {
      upsert: true,
      contentType: "application/x-ndjson"
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
    const { tickers, from, to } = await req.json();

    if (!tickers || !Array.isArray(tickers) || !from || !to) {
      return new Response(
        JSON.stringify({ error: "tickers (array), from, and to are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📡 Bulk Multi-TF Download`);
    console.log(`Tickers: ${tickers.length}`);
    console.log(`Period: ${from} to ${to}`);
    console.log(`Intervals: 1h, 4h, 1d, 1w, 1mo`);

    const intervals = ["1/hour", "4/hour", "1/day", "1/week", "1/month"];
    const results = [];
    const startTime = Date.now();

    for (const symbol of tickers) {
      console.log(`\n[${symbol}] Starting all timeframes...`);
      
      for (const interval of intervals) {
        const localPath = `/tmp/${symbol}_${interval.replace("/", "_")}.jsonl`;
        
        // Remove existing temp file
        try {
          await Deno.remove(localPath);
        } catch (_) {
          // Ignore
        }

        console.log(`[${symbol}] Downloading ${interval}...`);

        try {
          const bars = await fetchMassivePaginated(symbol, interval, from, to, localPath);

          if (bars > 0) {
            const url = await uploadToStorage(symbol, interval, localPath);
            results.push({
              symbol,
              interval,
              bars,
              url,
              status: "success"
            });
            console.log(`[${symbol}] ✅ ${interval}: ${bars} bars`);
          } else {
            results.push({
              symbol,
              interval,
              bars: 0,
              status: "no_data"
            });
            console.log(`[${symbol}] ⚠️ ${interval}: No data`);
          }

          // Cleanup
          try {
            await Deno.remove(localPath);
          } catch (_) {
            // Ignore
          }

        } catch (error) {
          console.error(`[${symbol}] ❌ ${interval} failed:`, error.message);
          results.push({
            symbol,
            interval,
            bars: 0,
            error: error.message,
            status: "error"
          });
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const totalBars = results.reduce((sum, r) => sum + (r.bars || 0), 0);
    const successful = results.filter(r => r.status === "success").length;

    console.log(`\n✅ Bulk download complete in ${duration} min`);
    console.log(`Total bars: ${totalBars.toLocaleString()}`);
    console.log(`Successful: ${successful}/${results.length}`);

    return new Response(
      JSON.stringify({
        status: "complete",
        duration_minutes: parseFloat(duration),
        total_bars: totalBars,
        successful,
        results
      }),
      { headers: { "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("ERROR:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
