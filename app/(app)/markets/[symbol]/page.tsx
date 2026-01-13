import { Topbar } from '@/components/layout/topbar';
import { Card, CardContent } from '@/components/ui/card';
import { SymbolNewsPanel } from '@/components/markets/symbol-news-panel';
import { SymbolChartClient } from '@/app/(components)/markets/SymbolChartClient';
import { StockDetailAiSection } from './StockDetailAiSection';
import { BacktestV46Viewer } from '@/components/backtest/BacktestV46Viewer';
import { createClient } from '@/lib/supabaseServer';
import { devForcePro } from '@/lib/subscription/devOverride';
import { loadApprovedTickers } from '@/lib/approvedTickers';
import { RequestTickerButton } from '@/components/markets/RequestTickerButton';
import { Card as UICard } from '@/components/ui/card';
import { BACKTEST_VERSION } from '@/lib/backtest/version';

interface SymbolDetailPageProps {
  params: Promise<{ symbol: string }>;
}

export default async function SymbolDetailPage({ params }: SymbolDetailPageProps) {
  const resolvedParams = await params;
  const symbol = (resolvedParams.symbol || '').toUpperCase();
  const supabase = await createClient();

  // Check PRO status (with dev mode override)
  const { data: { user } } = await supabase.auth.getUser();
  let isPro = devForcePro(); // Dev mode override
  if (!isPro && user) {
    const { data: profile } = await supabase
      .from('user_profiles')
      .select('subscription_status')
      .eq('id', user.id)
      .single();
    isPro = profile?.subscription_status === 'pro';
  }

  // Check if ticker is approved for AI features
  const approvedTickers = await loadApprovedTickers();
  const isApproved = approvedTickers.includes(symbol);

  // Fetch basic quote for header
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const {
    data: { session },
  } = await supabase.auth.getSession();

  let price: number | null = null;
  let change: number | null = null;
  let changePct: number | null = null;
  let currency: string | null = null;

  if (session) {
    const token = session.access_token || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/get_quote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ticker: symbol }),
        // Allow a small cache window to speed up TTFB while keeping data fresh
        next: { revalidate: 15 },
      } as RequestInit & { next: { revalidate: number } });
      if (resp.ok) {
        const data = await resp.json();
        price = data.price ?? null;
        change = data.change ?? null;
        changePct = data.changePercent ?? null;
        currency = data.currency ?? 'USD';
      }
    } catch (e) {
      console.error('[markets page] quote error', e);
    }
  }

  const pricePositive = (change ?? 0) >= 0;

  return (
    <div>
      <Topbar title={symbol} />
      <div className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content area */}
          <div className="lg:col-span-2 space-y-6">
            {/* Header */}
            <Card className="border-gray-200">
              <CardContent className="pt-5 pb-4 px-5 flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-baseline gap-2">
                    <h1 className="text-2xl font-semibold text-gray-900">{symbol}</h1>
                  </div>
                  {currency && (
                    <p className="text-xs text-gray-500 mt-1">Price in {currency}</p>
                  )}
                </div>
                <div className="text-right space-y-1">
                  <div className="text-2xl md:text-3xl font-semibold text-gray-900">
                    {price != null ? price.toFixed(2) : '--'}
                  </div>
                  <div className="flex items-center justify-end gap-2 text-xs">
                    <span
                      className={`px-2 py-0.5 rounded-full font-semibold ${
                        pricePositive
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-red-50 text-red-700'
                      }`}
                    >
                      {changePct != null ? `${pricePositive ? '+' : ''}${changePct.toFixed(2)}%` : '--'}
                    </span>
                    {change != null && (
                      <span className="text-gray-500">
                        {pricePositive ? '+' : ''}
                        {change.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Chart + timeframe selector (client, fetches its own data) */}
            <SymbolChartClient symbol={symbol} initialTimeframe="1D" />

            {/* PRO-gated AI section (reads existing AI data only) */}
            <StockDetailAiSection symbol={symbol} isApproved={isApproved} />
          </div>

          {/* Right sidebar - News */}
          <div className="lg:col-span-1">
            <SymbolNewsPanel symbol={symbol} limit={10} />
          </div>
        </div>
      </div>
    </div>
  );
}
