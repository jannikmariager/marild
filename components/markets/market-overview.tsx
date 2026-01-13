'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface IndexQuote {
  name: string;
  symbol: string;
  price: number | null;
  changePercent: number | null;
}

interface Sector {
  name: string;
  change: number;
  top: string;
}

interface Mover {
  symbol: string;
  name?: string;
  changePercent: number | null;
}

// Map Yahoo symbols to display names
const INDEX_NAMES: Record<string, string> = {
  '^GSPC': 'S&P 500',
  '^IXIC': 'Nasdaq',
  '^DJI': 'Dow Jones',
  '^RUT': 'Russell 2000',
};

export function MarketOverview() {
  const [indices, setIndices] = useState<IndexQuote[]>([]);
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [sectorsError, setSectorsError] = useState(false);
  const [topMovers, setTopMovers] = useState<Mover[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMarketData() {
      try {
        // Fetch indices
        const quotesResponse = await fetch('/api/market/quotes');
        if (quotesResponse.ok) {
          const quotesData = await quotesResponse.json();
          const indicesData = (quotesData.quotes || []).map((q: any) => ({
            name: INDEX_NAMES[q.symbol] || q.symbol,
            symbol: q.symbol,
            price: q.price,
            changePercent: q.changePercent,
          }));
          setIndices(indicesData);
        }

        // Fetch top movers
        const moversResponse = await fetch('/api/market/movers');
        if (moversResponse.ok) {
          const moversData = await moversResponse.json();
          const allMovers = [
            ...(moversData.gainers || []),
            ...(moversData.losers || []),
          ];
          setTopMovers(allMovers.slice(0, 10));
        }
      } catch (error) {
        console.error('Failed to fetch market data:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchMarketData();
  }, []);

  return (
    <Tabs defaultValue="indices" className="space-y-6">
      <TabsList>
        <TabsTrigger value="indices">Major Indices</TabsTrigger>
        <TabsTrigger value="sectors">Sectors</TabsTrigger>
        <TabsTrigger value="movers">Top Movers</TabsTrigger>
      </TabsList>

      <TabsContent value="indices" className="space-y-4">
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading market data...</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {indices.map((index) => (
              <Card key={index.symbol}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">{index.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <p className="text-2xl font-bold">
                      {index.price ? index.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A'}
                    </p>
                    <div className="flex items-center space-x-1">
                      {index.changePercent !== null && index.changePercent >= 0 ? (
                        <>
                          <TrendingUp className="h-4 w-4 text-green-600" />
                          <span className="text-green-600 font-medium">
                            +{index.changePercent.toFixed(2)}%
                          </span>
                        </>
                      ) : index.changePercent !== null ? (
                        <>
                          <TrendingDown className="h-4 w-4 text-red-600" />
                          <span className="text-red-600 font-medium">
                            {index.changePercent.toFixed(2)}%
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">N/A</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </TabsContent>

      <TabsContent value="sectors" className="space-y-4">
        <Card>
          <CardContent className="pt-6">
            {sectorsError || sectors.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">Sector data not available right now</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-medium">Sector</th>
                    <th className="pb-3 font-medium">Change</th>
                    <th className="pb-3 font-medium">Top Performers</th>
                  </tr>
                </thead>
                <tbody>
                  {sectors.map((sector) => (
                    <tr key={sector.name} className="border-b last:border-0">
                      <td className="py-4 font-medium">{sector.name}</td>
                      <td className="py-4">
                        {sector.change >= 0 ? (
                          <Badge variant="outline" className="text-green-600">
                            <TrendingUp className="h-3 w-3 mr-1" />
                            +{sector.change}%
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-red-600">
                            <TrendingDown className="h-3 w-3 mr-1" />
                            {sector.change}%
                          </Badge>
                        )}
                      </td>
                      <td className="py-4 text-sm text-muted-foreground">{sector.top}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="movers" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Top Movers Today</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-center py-8 text-muted-foreground">Loading movers...</div>
            ) : topMovers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No movers data available</div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 font-medium">Symbol</th>
                    <th className="pb-3 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {topMovers.map((stock) => (
                    <tr key={stock.symbol} className="border-b last:border-0">
                      <td className="py-4 font-mono font-bold">{stock.symbol}</td>
                      <td className="py-4">
                        {stock.changePercent !== null && stock.changePercent >= 0 ? (
                          <span className="text-green-600 font-medium">
                            +{stock.changePercent.toFixed(2)}%
                          </span>
                        ) : stock.changePercent !== null ? (
                          <span className="text-red-600 font-medium">
                            {stock.changePercent.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
