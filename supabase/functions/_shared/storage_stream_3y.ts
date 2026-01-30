/**
 * Storage Streaming Utilities for 3-Year OHLC Data
 * 
 * Memory-safe JSONL upload and append operations
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { OHLCBar } from "./massive_client_3y.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const BUCKET_NAME = "ohlc-cache-v2"; // Massive v2 OHLC cache

/**
 * Write JSONL to local disk (memory-safe streaming)
 */
async function writeJsonlToFile(path: string, bars: OHLCBar[]): Promise<void> {
  const file = await Deno.open(path, { write: true, create: true, append: true });
  const encoder = new TextEncoder();
  
  for (const bar of bars) {
    const line = JSON.stringify(bar) + "\n";
    await file.write(encoder.encode(line));
  }
  
  file.close();
}

/**
 * Upload JSONL stream to Supabase Storage
 * 
 * Streams bars in chunks to avoid memory issues
 */
export async function uploadJsonlStream(
  symbol: string,
  interval: string,
  barsIterator: AsyncGenerator<OHLCBar[], void, unknown>
): Promise<{ url: string; bars: number }> {
  const remotePath = `${symbol}/${interval}.jsonl`;
  const localPath = `/tmp/${symbol}_${interval}_${Date.now()}.jsonl`;
  
  let totalBars = 0;
  
  try {
    // Stream to local file first (memory-safe)
    for await (const bars of barsIterator) {
      await writeJsonlToFile(localPath, bars);
      totalBars += bars.length;
    }
    
    console.log(`[${symbol}] ${interval} - Uploading ${totalBars} bars to ${BUCKET_NAME}/${remotePath}`);
    
    // Upload to storage
    const fileBytes = await Deno.readFile(localPath);
    
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(remotePath, fileBytes, {
        contentType: "application/x-ndjson",
        upsert: true
      });
    
    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }
    
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(remotePath);
    
    return {
      url: urlData.publicUrl,
      bars: totalBars
    };
    
  } finally {
    // Cleanup temp file
    try {
      await Deno.remove(localPath);
    } catch {
      // Ignore
    }
  }
}

/**
 * Get last timestamp from existing JSONL file
 */
async function getLastTimestamp(symbol: string, interval: string): Promise<number | null> {
  const remotePath = `${symbol}/${interval}.jsonl`;
  
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET_NAME)
      .download(remotePath);
    
    if (error || !data) {
      return null; // File doesn't exist
    }
    
    const text = await data.text();
    const lines = text.trim().split('\n');
    
    if (lines.length === 0) {
      return null;
    }
    
    // Get last line
    const lastLine = lines[lines.length - 1];
    const lastBar = JSON.parse(lastLine);
    
    return lastBar.t; // timestamp in milliseconds
    
  } catch (error) {
    console.error(`[${symbol}] ${interval} - Error reading existing file:`, error.message);
    return null;
  }
}

/**
 * Append new bars to existing JSONL file
 * 
 * Only appends bars with timestamp > last existing timestamp
 */
export async function appendJsonlStream(
  symbol: string,
  interval: string,
  barsIterator: AsyncGenerator<OHLCBar[], void, unknown>
): Promise<{ url: string; bars: number; appended: number }> {
  const remotePath = `${symbol}/${interval}.jsonl`;
  const localPath = `/tmp/${symbol}_${interval}_append_${Date.now()}.jsonl`;
  
  // Get last timestamp from existing file
  const lastTimestamp = await getLastTimestamp(symbol, interval);
  
  console.log(`[${symbol}] ${interval} - Last timestamp: ${lastTimestamp ? new Date(lastTimestamp).toISOString() : 'none (new file)'}`);
  
  let totalBars = 0;
  let newBars = 0;
  
  try {
    // Download existing file if it exists
    if (lastTimestamp) {
      const { data, error } = await supabase.storage
        .from(BUCKET_NAME)
        .download(remotePath);
      
      if (!error && data) {
        const existingContent = await data.arrayBuffer();
        await Deno.writeFile(localPath, new Uint8Array(existingContent));
      }
    }
    
    // Append new bars (only those after lastTimestamp)
    for await (const bars of barsIterator) {
      const filteredBars = lastTimestamp 
        ? bars.filter(bar => bar.t > lastTimestamp)
        : bars;
      
      if (filteredBars.length > 0) {
        await writeJsonlToFile(localPath, filteredBars);
        newBars += filteredBars.length;
      }
      
      totalBars += bars.length;
    }
    
    console.log(`[${symbol}] ${interval} - Appending ${newBars} new bars (${totalBars} total fetched)`);
    
    // Upload updated file
    const fileBytes = await Deno.readFile(localPath);
    
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(remotePath, fileBytes, {
        contentType: "application/x-ndjson",
        upsert: true
      });
    
    if (error) {
      throw new Error(`Upload failed: ${error.message}`);
    }
    
    const { data: urlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(remotePath);
    
    return {
      url: urlData.publicUrl,
      bars: totalBars,
      appended: newBars
    };
    
  } finally {
    // Cleanup temp file
    try {
      await Deno.remove(localPath);
    } catch {
      // Ignore
    }
  }
}

/**
 * Check if file exists in storage
 */
export async function fileExists(symbol: string, interval: string): Promise<boolean> {
  const remotePath = `${symbol}/${interval}.jsonl`;
  
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .list(symbol, {
      search: `${interval}.jsonl`
    });
  
  return !error && data && data.length > 0;
}
