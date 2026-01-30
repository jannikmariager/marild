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
 * Read last timestamp from existing JSONL file
 * Only reads the last line to minimize memory
 */
async function getLastTimestamp(url: string): Promise<number | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`File not found: ${url}`);
      return null;
    }

    const text = await res.text();
    const lines = text.trim().split("\n");
    if (!lines.length) return null;

    // Parse last line only
    const lastLine = lines[lines.length - 1];
    const last = JSON.parse(lastLine);
    
    // Polygon uses 't' for timestamp in milliseconds
    return last.t || last.timestamp || last.time || null;
    
  } catch (error) {
    console.error(`Error reading last timestamp from ${url}:`, error.message);
    return null;
  }
}

/**
 * Stream append new bars to local file
 */
async function appendJSONL(path: string, rows: any[]) {
  const file = await Deno.open(path, { write: true, append: true, create: true });
  const enc = new TextEncoder();
  for (const r of rows) {
    await file.write(enc.encode(JSON.stringify(r) + "\n"));
  }
  file.close();
}

/**
 * Fetch new bars from Massive API after a given timestamp
 */
async function fetchNewBars(
  symbol: string,
  interval: string,
  sinceMs: number,
  localPath: string
): Promise<number> {
  // Convert to Unix seconds for Polygon API
  const from = Math.floor(sinceMs / 1000);
  const to = Math.floor(Date.now() / 1000);

  const [multiplier, timespan] = interval.split("/");
  
  let url = `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}/${from}/${to}?adjusted=true&sort=asc&limit=50000&apiKey=${MASSIVE_API_KEY}`;
  let totalBars = 0;
  let page = 1;

  while (url) {
    console.log(`[${symbol}] ${interval} Update Page ${page}`);
    
    const res = await fetch(url);
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[${symbol}] ERROR ${res.status}: ${errorText}`);
      break;
    }

    const json = await res.json();
    if (!json?.results?.length) {
      console.log(`[${symbol}] ${interval} - No new data`);
      break;
    }

    // Filter out bars we already have (where t <= sinceMs)
    const newBars = json.results.filter((bar: any) => bar.t > sinceMs);
    
    if (newBars.length > 0) {
      await appendJSONL(localPath, newBars);
      totalBars += newBars.length;
      console.log(`[${symbol}] ${interval} Page ${page}: ${newBars.length} new bars (total: ${totalBars})`);
    }

    url = json?.next_url ? `${json.next_url}&apiKey=${MASSIVE_API_KEY}` : null;
    page++;

    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return totalBars;
}

/**
 * Download existing file, append new data, re-upload
 */
async function updateAndUpload(
  symbol: string,
  interval: string,
  newBarsPath: string,
  publicUrl: string
): Promise<string> {
  // Download existing file
  const existingRes = await fetch(publicUrl);
  const existingData = await existingRes.text();

  // Read new bars
  const newData = await Deno.readTextFile(newBarsPath);

  // Combine
  const combined = existingData.trim() + "\n" + newData.trim();

  // Clean interval name
  const cleanInterval = interval.replace("/hour", "h")
    .replace("/day", "d")
    .replace("/week", "w")
    .replace("/month", "mo");
  
  const remotePath = `${symbol}/${cleanInterval}.jsonl`;

  // Upload combined file
  const { error } = await supabase.storage
    .from("ohlc-cache-v2")
    .upload(remotePath, combined, {
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
    const { tickers } = await req.json();

    if (!tickers || !Array.isArray(tickers)) {
      return new Response(
        JSON.stringify({ error: "tickers (array) is required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log(`📡 Daily Multi-TF Update`);
    console.log(`Tickers: ${tickers.length}`);
    console.log(`Intervals: 1h, 4h, 1d, 1w, 1mo`);

    const intervals = ["1/hour", "4/hour", "1/day", "1/week", "1/month"];
    const updates = [];
    const startTime = Date.now();

    for (const symbol of tickers) {
      console.log(`\n[${symbol}] Checking for updates...`);
      
      for (const interval of intervals) {
        const cleanInterval = interval.replace("/hour", "h")
          .replace("/day", "d")
          .replace("/week", "w")
          .replace("/month", "mo");
        
        const filePath = `${symbol}/${cleanInterval}.jsonl`;
        const { data } = supabase.storage
          .from("ohlc-cache-v2")
          .getPublicUrl(filePath);

        // Get last timestamp from existing file
        const lastTs = await getLastTimestamp(data.publicUrl);
        
        if (!lastTs) {
          console.log(`[${symbol}] ${interval} - No existing file, skipping`);
          updates.push({
            symbol,
            interval,
            updated: false,
            reason: "no_existing_file"
          });
          continue;
        }

        console.log(`[${symbol}] ${interval} - Last bar: ${new Date(lastTs).toISOString()}`);

        const localPath = `/tmp/update_${symbol}_${interval.replace("/", "_")}.jsonl`;
        
        try {
          await Deno.remove(localPath);
        } catch (_) {
          // Ignore
        }

        // Fetch new bars
        const newBars = await fetchNewBars(symbol, interval, lastTs, localPath);

        if (newBars === 0) {
          console.log(`[${symbol}] ${interval} - Already up to date`);
          updates.push({
            symbol,
            interval,
            updated: false,
            reason: "up_to_date"
          });
          
          try {
            await Deno.remove(localPath);
          } catch (_) {
            // Ignore
          }
          continue;
        }

        // Append to existing and re-upload
        console.log(`[${symbol}] ${interval} - Merging ${newBars} new bars...`);
        const url = await updateAndUpload(symbol, interval, localPath, data.publicUrl);

        updates.push({
          symbol,
          interval,
          updated: true,
          newBars,
          url
        });

        console.log(`[${symbol}] ✅ ${interval}: +${newBars} bars`);

        // Cleanup
        try {
          await Deno.remove(localPath);
        } catch (_) {
          // Ignore
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    const totalUpdated = updates.filter(u => u.updated).length;
    const totalNewBars = updates.reduce((sum, u) => sum + (u.newBars || 0), 0);

    console.log(`\n✅ Daily update complete in ${duration} min`);
    console.log(`Updated: ${totalUpdated}/${updates.length}`);
    console.log(`New bars: ${totalNewBars}`);

    return new Response(
      JSON.stringify({
        status: "updated",
        duration_minutes: parseFloat(duration),
        total_updated: totalUpdated,
        total_new_bars: totalNewBars,
        updates
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
