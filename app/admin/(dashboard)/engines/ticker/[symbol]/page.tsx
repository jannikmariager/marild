import { QueryProvider } from '@/components/providers/query-provider';
import { TickerDeepDive } from '@/components/admin/engines/TickerDeepDive';

interface PageProps {
  params: { symbol?: string };
}

export default function EngineTickerPage({ params }: PageProps) {
  const rawSymbol = params?.symbol ?? '';
  const symbol = rawSymbol.toString().toUpperCase();

  if (!symbol) {
    // Gracefully handle malformed routes instead of crashing
    return (
      <div className="text-sm text-slate-500">No ticker provided for engine deep dive.</div>
    );
  }

  return (
    <QueryProvider>
      <div className="space-y-6">
        <TickerDeepDive symbol={symbol} />
      </div>
    </QueryProvider>
  );
}
