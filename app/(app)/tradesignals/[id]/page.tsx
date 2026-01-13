import { createClient } from '@/lib/supabaseServer';
import { notFound } from 'next/navigation';
import { Topbar } from '@/components/layout/topbar';
import { TradePlanCard } from '@/components/tradesignal/trade-plan-card';
import { SummaryCard } from '@/components/tradesignal/summary-card';
import { ReasonAccordion } from '@/components/tradesignal/reason-accordion';
import { ProDeepDive } from '@/components/tradesignal/pro-deep-dive';
import Link from 'next/link';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

async function fetchSignal(id: string) {
  try {
    const supabase = await createClient();
    
    const { data, error } = await supabase
      .from('ai_signals')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      console.error(`[TradeSignalPage] Supabase error for id=${id}:`, error.message);
      return null;
    }

    if (!data) {
      console.warn(`[TradeSignalPage] No signal found for id=${id}`);
      return null;
    }

    return data;
  } catch (err) {
    console.error(`[TradeSignalPage] Exception fetching signal id=${id}:`, err);
    return null;
  }
}

export default async function TradeSignalPage({ params }: PageProps) {
  const { id } = await params;
  
  // Validate UUID format
  if (!id || !isValidUUID(id)) {
    console.warn(`[TradeSignalPage] Invalid signal ID format: ${id}`);
    notFound();
  }
  
  const signal = await fetchSignal(id);

  if (!signal) {
    console.info(`[TradeSignalPage] Signal not found for id=${id}`);
    notFound();
  }

  // Determine trading style from timeframe
  const tradingStyle = determineTradingStyle(signal.timeframe);
  const isInvest = tradingStyle === 'invest';

  return (
    <div>
      <Topbar title={`${signal.symbol} TradeSignal`} />
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <TradePlanCard signal={signal} />
        
        {signal.reasoning && (
          <SummaryCard summary={signal.reasoning} />
        )}
        
        {signal.reasons && (
          <ReasonAccordion signal={signal} />
        )}

        {isInvest && (
          <ProDeepDive signal={signal} />
        )}
      </div>
    </div>
  );
}

function determineTradingStyle(timeframe: string): 'daytrade' | 'swing' | 'invest' {
  const tf = timeframe.toLowerCase();
  if (tf === '5m' || tf === '15m' || tf === '1h') return 'daytrade';
  if (tf === '4h') return 'swing';
  return 'invest'; // 1d, 1w
}

function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}
