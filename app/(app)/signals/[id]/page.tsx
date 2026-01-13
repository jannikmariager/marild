import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabaseServer';
import { Topbar } from '@/components/layout/topbar';
import { SignalHeader } from '@/components/tradesignal/signal-header';
import { SummaryCard } from '@/components/tradesignal/summary-card';
import { ReasonAccordion } from '@/components/tradesignal/reason-accordion';
import { ProDeepDive } from '@/components/tradesignal/pro-deep-dive';

interface PageProps {
  params: Promise<{
    id: string;
  }>;
}

async function fetchSignal(id: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('ai_signals')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) {
    return null;
  }

  return data;
}

export default async function SignalDetailPage({ params }: PageProps) {
  const resolvedParams = await params;
  const signal = await fetchSignal(resolvedParams.id);

  if (!signal) {
    // Friendly fallback instead of raw 404 if a signal has been archived or not found
    redirect('/signals/error?reason=missing_signal');
  }

  const tradingStyle = determineTradingStyle(signal.timeframe);
  const isInvest = tradingStyle === 'invest';

  return (
    <div>
      <Topbar title={`${signal.symbol} TradeSignal`} />
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        <SignalHeader signal={signal} />

        {signal.reasoning && <SummaryCard summary={signal.reasoning} />}

        {signal.reasons && <ReasonAccordion signal={signal} />}

        {isInvest && <ProDeepDive signal={signal} />}
      </div>
    </div>
  );
}

function determineTradingStyle(timeframe: string): 'daytrade' | 'swing' | 'invest' {
  const tf = timeframe.toLowerCase();
  if (tf === '5m' || tf === '15m' || tf === '1h') return 'daytrade';
  if (tf === '4h') return 'swing';
  return 'invest';
}
