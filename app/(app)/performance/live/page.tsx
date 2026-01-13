import { Metadata } from 'next';
import LiveTrading from '@/components/performance/LiveTrading';
import AITradeLog from '@/components/performance/AITradeLog';
import { getCurrentUser } from '@/lib/auth';
import { hasProAccess } from '@/lib/subscription/devOverride';
import ProLockedCard from '@/components/feed/ProLockedCard';

export const metadata: Metadata = {
  title: 'Live Portfolio | Marild AI',
  description: 'View real-time model portfolio positions, equity curve, and executed trades.',
};

export default async function LivePortfolioPage() {
  const user = await getCurrentUser();
  // Canonical PRO check based on users.subscription_tier, with DEV override
  const isPro = hasProAccess(user?.subscription_tier === 'pro');

  return (
    <div className="container max-w-6xl mx-auto px-4 py-8 space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Live Portfolio</h1>
        <p className="text-gray-600 text-lg">
          Real-time view of the model portfolios executing AI signals. Read-only, fully transparent.
        </p>
        <p className="text-sm text-gray-500">
          All signals are generated and executed on the 1-hour timeframe. Higher and lower timeframes are used internally for confirmation.
        </p>
      </header>

      <section>
        <LiveTrading isPro={isPro} />
      </section>

      <section>
        <ProLockedCard
          isLocked={!isPro}
          featureName="Trade Log & Open Positions"
          description="View every executed trade, entry/exit reasons, and open positions with risk tracking."
        >
          <AITradeLog />
        </ProLockedCard>
      </section>
    </div>
  );
}
