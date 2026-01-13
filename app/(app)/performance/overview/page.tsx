import { Metadata } from 'next';
import PerformanceClient from '@/components/performance/PerformanceClient';
import LiveTradingCriteriaCard from '../components/LiveTradingCriteriaCard';
import PerformanceOverview from '@/components/performance/PerformanceOverview';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export const metadata: Metadata = {
  title: 'Market Coverage & Signal Eligibility | Marild AI',
  description: 'See which symbols are monitored by the Marild engine and their signal eligibility characteristics.',
};

export default function PerformanceOverviewPage() {
  return (
    <div className="container max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col gap-2 mb-1">
          <h1 className="text-3xl font-bold text-gray-900">
            Market Coverage &amp; Signal Eligibility
          </h1>
          <p className="text-gray-600 text-lg">
            This page shows which symbols are currently monitored by the Marild engine and how frequently valid signal
            conditions appear.
          </p>
          <p className="text-sm text-gray-700 mt-1">
            This is not a performance or backtesting view. Live performance for Active Signals is tracked separately.
          </p>
        </div>
      </div>

      {/* Tabs: keep Live Performance under a secondary tab so routes stay stable */}
      <Tabs defaultValue="coverage" className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex-1" />
          <TabsList className="bg-gray-100 rounded-full p-1">
            <TabsTrigger
              value="coverage"
              className="text-sm rounded-full"
            >
              Coverage &amp; Eligibility
            </TabsTrigger>
            <TabsTrigger
              value="performance"
              className="text-sm rounded-full"
            >
              Live Performance
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="coverage" className="space-y-6">
          <PerformanceOverview />
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          {/* Live trading criteria / rules and existing performance view remain unchanged */}
          <div>
            <LiveTradingCriteriaCard />
          </div>
          <PerformanceClient />
        </TabsContent>
      </Tabs>
    </div>
  );
}
