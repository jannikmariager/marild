/**
 * Daily Morning Briefing Edge Function
 *
 * Sends a pre-market "good morning" briefing to Discord and exposes
 * the same content to clients (Flutter app, web) as JSON.
 *
 * Intended schedule: 12:15 UTC (2h15m before US cash open 14:30 UTC)
 * Cron example: "15 12 * * 1-5" (configured in Supabase dashboard).
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DailyStats {
  total_trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  best_ticker: string | null;
  best_pnl_pct: number | null;
  worst_ticker: string | null;
  worst_pnl_pct: number | null;
}

interface TodayOutlook {
  correction_risk_score: number | null;
  correction_risk_label: string | null;
  commentary: string;
}

interface MorningBriefingResponse {
  greeting: string;
  variant_id: number;
  date: string; // trading date being referenced (YYYY-MM-DD)
  generated_at: string;
  yesterday: DailyStats;
  today: TodayOutlook;
}

const GREETING_TEMPLATES: string[] = [
  'Good morning – the signal engines are warming up for today\'s session.',
  'Rise and shine. Marild AI is getting ready to scan the market for you.',
  'Good morning trader – pre-market prep is running and signals will start soon.',
  'New trading day, same playbook – Marild AI is lining up today\'s opportunities.',
  'Good morning – markets are waking up and our models are already crunching the data.',
  'Welcome back – today\'s signal run is being prepared behind the scenes.',
  'Good morning – your AI co-pilot is running pre-market checks right now.',
  'Coffee first, signals second – Marild AI is getting ready for the open.',
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    const { tradingDate, tradingDateIso } = getPreviousTradingDate(now);

    // 1) Compute yesterday's live trading stats (SWING engine)
    const yesterdayStats = await computeDailyStats(supabase, tradingDateIso);

    // 2) Fetch latest correction risk snapshot for today outlook
    const todayOutlook = await buildTodayOutlook(supabase);

    // 3) Pick a random greeting template (stable per day)
    const variantIndex = pickVariantForDate(tradingDateIso, GREETING_TEMPLATES.length);
    const greeting = GREETING_TEMPLATES[variantIndex];

    const payload: MorningBriefingResponse = {
      greeting,
      variant_id: variantIndex,
      date: tradingDateIso,
      generated_at: now.toISOString(),
      yesterday: yesterdayStats,
      today: todayOutlook,
    };

    // If this is a cron/explicit trigger, also post to Discord
    const triggerHeader = req.headers.get('x-morning-trigger') || '';
    const shouldPostToDiscord =
      triggerHeader.toLowerCase() === 'discord' || req.method === 'POST';

    if (shouldPostToDiscord) {
      await postToDiscord(payload).catch((err) => {
        console.warn('[daily_morning_briefing] Failed to post to Discord:', err);
      });
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('[daily_morning_briefing] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: 'internal_error', message: error?.message ?? 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});

function getPreviousTradingDate(now: Date): { tradingDate: Date; tradingDateIso: string } {
  const d = new Date(now);
  // Step back at least one full day, then skip weekends
  d.setUTCDate(d.getUTCDate() - 1);

  // 0=Sun,1=Mon,...,6=Sat
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }

  const iso = d.toISOString().split('T')[0];
  return { tradingDate: d, tradingDateIso: iso };
}

async function computeDailyStats(supabase: any, tradingDateIso: string): Promise<DailyStats> {
  const start = new Date(tradingDateIso + 'T00:00:00.000Z');
  const end = new Date(tradingDateIso + 'T23:59:59.999Z');

  const { data: trades, error } = await supabase
    .from('live_trades')
    .select('*')
    .gte('exit_timestamp', start.toISOString())
    .lte('exit_timestamp', end.toISOString())
    .order('exit_timestamp', { ascending: false });

  if (error) {
    console.error('[daily_morning_briefing] Failed to fetch trades:', error);
    return {
      total_trades: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      total_pnl: 0,
      best_ticker: null,
      best_pnl_pct: null,
      worst_ticker: null,
      worst_pnl_pct: null,
    };
  }

  const list = trades || [];
  const totalTrades = list.length;
  const wins = list.filter((t: any) =>
    t.exit_reason === 'TP_HIT' || (t.realized_pnl_dollars ?? 0) > 0,
  ).length;
  const losses = list.filter((t: any) =>
    t.exit_reason === 'SL_HIT' || (t.realized_pnl_dollars ?? 0) < 0,
  ).length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const totalPnl = list.reduce(
    (sum: number, t: any) => sum + (t.realized_pnl_dollars ?? 0),
    0,
  );

  let best_ticker: string | null = null;
  let best_pnl_pct: number | null = null;
  let worst_ticker: string | null = null;
  let worst_pnl_pct: number | null = null;

  if (list.length > 0) {
    const sorted = [...list].sort(
      (a, b) => (b.realized_pnl_dollars ?? 0) - (a.realized_pnl_dollars ?? 0),
    );
    const best = sorted[0];
    const worst = sorted[sorted.length - 1];

    if (best && best.entry_price && best.exit_price) {
      const side = best.side || 'LONG';
      const rawPct = ((best.exit_price - best.entry_price) / best.entry_price) * 100;
      best_pnl_pct = side === 'SHORT' ? -rawPct : rawPct;
      best_ticker = best.ticker || null;
    }

    if (worst && worst.entry_price && worst.exit_price) {
      const side = worst.side || 'LONG';
      const rawPct = ((worst.exit_price - worst.entry_price) / worst.entry_price) * 100;
      worst_pnl_pct = side === 'SHORT' ? -rawPct : rawPct;
      worst_ticker = worst.ticker || null;
    }
  }

  return {
    total_trades: totalTrades,
    wins,
    losses,
    win_rate: winRate,
    total_pnl: totalPnl,
    best_ticker,
    best_pnl_pct,
    worst_ticker,
    worst_pnl_pct,
  };
}

async function buildTodayOutlook(supabase: any): Promise<TodayOutlook> {
  const { data, error } = await supabase
    .from('correction_risk_snapshots')
    .select('risk_score, risk_label, as_of_date')
    .order('as_of_date', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.warn('[daily_morning_briefing] No correction risk snapshot found:', error);
    return {
      correction_risk_score: null,
      correction_risk_label: null,
      commentary:
        'No fresh risk snapshot available. Expect mixed conditions – focus on clean setups and strict risk management.',
    };
  }

  const score = data.risk_score as number;
  const label = (data.risk_label as string | null) ?? null;

  let commentary: string;
  if (score < 35) {
    commentary =
      'AI models see a relatively low risk of sharp downside. Environment favors taking high-quality swing setups, but avoid over-leverage.';
  } else if (score < 60) {
    commentary =
      'Risk is balanced. Expect two-sided action with both long and short opportunities. Be selective and keep position sizing disciplined.';
  } else {
    commentary =
      'Correction risk is elevated. Expect choppier, headline-driven trading. Capital preservation and tight stops are more important than aggression.';
  }

  return {
    correction_risk_score: score,
    correction_risk_label: label,
    commentary,
  };
}

function pickVariantForDate(dateIso: string, variantCount: number): number {
  // Simple deterministic hash: same date => same variant index
  let hash = 0;
  for (let i = 0; i < dateIso.length; i++) {
    hash = (hash * 31 + dateIso.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % Math.max(variantCount, 1);
  return idx;
}

async function postToDiscord(payload: MorningBriefingResponse): Promise<void> {
  const webhookUrl = Deno.env.get('DISCORD_SIGNALS_WEBHOOK') || Deno.env.get('DISCORD_WEBHOOK_URL');
  if (!webhookUrl) {
    console.warn('[daily_morning_briefing] No Discord webhook configured, skipping post');
    return;
  }

  const dateStr = new Date(payload.date + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const stats = payload.yesterday;
  const today = payload.today;

  const tradesLine = stats.total_trades > 0
    ? `**Trades:** ${stats.total_trades}  •  **Win rate:** ${stats.win_rate.toFixed(1)}%  •  **P&L:** ${stats.total_pnl >= 0 ? '+' : ''}$${stats.total_pnl.toFixed(0)}`
    : 'No closed trades were recorded yesterday.';

  let notable = '';
  if (stats.best_ticker && stats.best_pnl_pct !== null) {
    notable += `🏆 **Best:** ${stats.best_ticker} (${stats.best_pnl_pct >= 0 ? '+' : ''}${stats.best_pnl_pct.toFixed(2)}%)\n`;
  }
  if (stats.worst_ticker && stats.worst_pnl_pct !== null) {
    notable += `📉 **Worst:** ${stats.worst_ticker} (${stats.worst_pnl_pct.toFixed(2)}%)`;
  }
  if (!notable) {
    notable = 'No notable trades yesterday.';
  }

  const riskLine = today.correction_risk_score !== null
    ? `**Risk score:** ${today.correction_risk_score.toFixed(1)}  •  **Label:** ${today.correction_risk_label ?? 'N/A'}`
    : 'No fresh correction risk snapshot. Treat conditions as mixed for now with both long and short setups possible.';

  const embed = {
    title: `🌅 Good Morning – Pre-Market Briefing (${dateStr})`,
    description: payload.greeting,
    color: 0x0aae84,
    fields: [
      {
        name: '📆 Yesterday\'s Live Performance',
        value: tradesLine,
        inline: false,
      },
      {
        name: '🎯 Notable Trades',
        value: notable,
        inline: false,
      },
      {
        name: '🧠 Today\'s Market Outlook',
        value: `${riskLine}\n\n${today.commentary}`,
        inline: false,
      },
      {
        name: '📌 How to use this',
        value: 'The AI engine will scan US stocks during regular market hours and highlight the clearest opportunities based on confidence and risk. The **top 15 highest-confidence signals** are posted here in Discord; the **full signal list** is always available in the Marild web and mobile apps. This briefing is informational only and **not** financial advice.',
        inline: false,
      },
    ],
    footer: {
      text: 'Marild AI • Pre-market briefing • Not financial advice',
    },
    timestamp: payload.generated_at,
  };

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!response.ok) {
    console.error('[daily_morning_briefing] Discord webhook failed:', response.status, await response.text());
  } else {
    console.log('[daily_morning_briefing] Posted morning briefing to Discord');
  }
}
