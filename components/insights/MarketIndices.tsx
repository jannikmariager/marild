'use client';

import { TrendingUp, TrendingDown } from 'lucide-react';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabaseBrowser';

interface IndexData {
  ticker: string;
  price: number;
  change_percent: number;
}

export default function MarketIndices() {
  const [indices, setIndices] = useState<IndexData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  useEffect(() => {
    fetchIndices();
  }, []);

  const fetchIndices = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const { data, error: funcError } = await supabase.functions.invoke('get_indices', {
        body: {},
      });

      if (funcError) throw funcError;

      const indicesData = data?.data || [];
      setIndices(indicesData.slice(0, 6));
    } catch (err) {
      console.error('Error fetching indices:', err);
      setError('Failed to load indices');
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <LoadingState />;
  }

  if (error) {
    return <ErrorState error={error} />;
  }

  if (indices.length === 0) {
    return <EmptyState />;
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      {indices.map((index, idx) => (
        <IndexRow key={index.ticker} index={index} isLast={idx === indices.length - 1} />
      ))}
    </div>
  );
}

function IndexRow({ index, isLast }: { index: IndexData; isLast: boolean }) {
  const isPositive = index.change_percent >= 0;

  const getIndexName = (ticker: string): string => {
    const names: Record<string, string> = {
      '^GSPC': 'S&P 500',
      '^IXIC': 'NASDAQ',
      '^DJI': 'Dow Jones',
      '^FTSE': 'FTSE 100',
      '^GDAXI': 'DAX',
      '^N225': 'Nikkei 225',
      '^HSI': 'Hang Seng',
      '^FCHI': 'CAC 40',
    };
    return names[ticker] || ticker;
  };

  return (
    <div
      className={`flex items-center justify-between p-4 ${
        !isLast ? 'border-b border-gray-200' : ''
      }`}
    >
      <div className="flex-1">
        <h4 className="font-semibold text-gray-900">{getIndexName(index.ticker)}</h4>
        <p className="text-sm text-gray-500">{index.ticker}</p>
      </div>
      <div className="text-right">
        <p className="font-semibold text-gray-900">{index.price.toFixed(2)}</p>
        <div className={`flex items-center justify-end gap-1 text-sm font-semibold ${
          isPositive ? 'text-green-600' : 'text-red-600'
        }`}>
          {isPositive ? (
            <TrendingUp className="w-4 h-4" />
          ) : (
            <TrendingDown className="w-4 h-4" />
          )}
          <span>
            {isPositive ? '+' : ''}
            {index.change_percent.toFixed(2)}%
          </span>
        </div>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-6">
      <div className="animate-pulse space-y-4">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="flex justify-between items-center">
            <div className="space-y-2">
              <div className="h-4 bg-gray-200 rounded w-24" />
              <div className="h-3 bg-gray-200 rounded w-16" />
            </div>
            <div className="space-y-2 text-right">
              <div className="h-4 bg-gray-200 rounded w-20" />
              <div className="h-3 bg-gray-200 rounded w-16" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorState({ error }: { error: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm text-center">
      <p className="text-sm text-gray-500">{error}</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm text-center">
      <p className="text-sm text-gray-500">No indices available</p>
    </div>
  );
}
