import { Metadata } from 'next';
import TickerPerformanceClient from './components/TickerPerformanceClient';

type Props = {
  params: Promise<{
    ticker: string;
  }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolvedParams = await params;
  const ticker = resolvedParams.ticker.toUpperCase();

  return {
    title: `${ticker} Coverage & Eligibility | Marild AI`,
    description: `See how ${ticker} is monitored by the Marild engine and its signal eligibility characteristics.`,
  };
}

export default async function TickerPerformancePage({ params }: Props) {
  const resolvedParams = await params;
  const ticker = resolvedParams.ticker.toUpperCase();

  return (
    <div className="container max-w-7xl mx-auto px-4 py-6">
      <TickerPerformanceClient ticker={ticker} />
    </div>
  );
}
