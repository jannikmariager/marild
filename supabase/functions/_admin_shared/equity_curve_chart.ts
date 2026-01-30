/**
 * Equity Curve Chart Generator
 * 
 * For now, returns a placeholder chart URL
 * TODO: In production, generate actual PNG chart using:
 * - QuickChart.io API
 * - Chart.js server-side rendering
 * - Or upload generated image to Imgur/Discord CDN
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

/**
 * Generate equity curve chart URL
 * Uses QuickChart.io for serverless chart generation
 */
export async function generateEquityCurveChart(
  supabase: any,
  days: number = 30
): Promise<string | null> {
  try {
    // Fetch recent equity curve data
    const { data: snapshots, error } = await supabase
      .from("equity_curve_snapshots")
      .select("as_of_date, cumulative_pl_percent")
      .order("as_of_date", { ascending: true })
      .limit(days);

    if (error || !snapshots || snapshots.length === 0) {
      console.warn("No equity curve data available for chart");
      return null;
    }

    // Prepare data for chart
    const dates = snapshots.map((s: any) => s.as_of_date);
    const values = snapshots.map((s: any) => s.cumulative_pl_percent);

    // Generate chart using QuickChart.io
    const chartConfig = {
      type: "line",
      data: {
        labels: dates,
        datasets: [
          {
            label: "Cumulative Return %",
            data: values,
            borderColor: values[values.length - 1] >= 0 ? "#0AAE84" : "#FF3B30", // Mint or Red
            backgroundColor: values[values.length - 1] >= 0 ? "rgba(10, 174, 132, 0.1)" : "rgba(255, 59, 48, 0.1)",
            borderWidth: 2,
            fill: true,
            tension: 0.4,
          },
        ],
      },
      options: {
        plugins: {
          title: {
            display: true,
            text: "TradeLens AI – Equity Curve",
            color: "#FFFFFF",
            font: { size: 16, weight: "bold" },
          },
          legend: { display: false },
        },
        scales: {
          x: {
            ticks: { color: "#9CA3AF", maxRotation: 45 },
            grid: { color: "rgba(255, 255, 255, 0.1)" },
          },
          y: {
            ticks: {
              color: "#9CA3AF",
              callback: (value: number) => value + "%",
            },
            grid: { color: "rgba(255, 255, 255, 0.1)" },
          },
        },
      },
    };

    // Encode chart config for URL
    const chartJson = JSON.stringify(chartConfig);
    const encodedChart = encodeURIComponent(chartJson);

    // QuickChart.io URL with dark theme
    const chartUrl = `https://quickchart.io/chart?c=${encodedChart}&backgroundColor=rgb(26,26,26)&width=800&height=400`;

    console.log("Generated equity curve chart URL");
    return chartUrl;
  } catch (error) {
    console.error("Failed to generate chart:", error);
    return null;
  }
}

/**
 * Get cumulative P/L from equity curve snapshots
 */
export async function getCumulativePL(supabase: any): Promise<number> {
  try {
    const { data, error } = await supabase
      .from("equity_curve_snapshots")
      .select("cumulative_pl_percent")
      .order("as_of_date", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      console.warn("No equity curve data found, returning 0");
      return 0;
    }

    return data.cumulative_pl_percent || 0;
  } catch (error) {
    console.error("Failed to get cumulative P/L:", error);
    return 0;
  }
}

/**
 * Save equity curve snapshot
 */
export async function saveEquityCurveSnapshot(
  supabase: any,
  snapshot: {
    as_of_date: Date;
    cumulative_pl_percent: number;
    daily_pl_percent: number;
    total_signals: number;
    winning_signals: number;
    losing_signals: number;
    win_rate: number;
  }
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("equity_curve_snapshots")
      .upsert(
        {
          as_of_date: snapshot.as_of_date.toISOString().split("T")[0],
          cumulative_pl_percent: snapshot.cumulative_pl_percent,
          daily_pl_percent: snapshot.daily_pl_percent,
          total_signals: snapshot.total_signals,
          winning_signals: snapshot.winning_signals,
          losing_signals: snapshot.losing_signals,
          win_rate: snapshot.win_rate,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "as_of_date" }
      );

    if (error) {
      console.error("Failed to save equity curve snapshot:", error);
      return false;
    }

    console.log("Saved equity curve snapshot for", snapshot.as_of_date.toISOString().split("T")[0]);
    return true;
  } catch (error) {
    console.error("Failed to save snapshot:", error);
    return false;
  }
}
