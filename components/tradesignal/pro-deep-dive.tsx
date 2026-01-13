'use client';

import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { 
  TrendingUp, 
  TrendingDown, 
  BarChart3, 
  Newspaper, 
  Building2, 
  Globe 
} from 'lucide-react';

interface ProDeepDiveProps {
  signal: any;
}

export function ProDeepDive({ signal }: ProDeepDiveProps) {
  const hasSmcData = signal.smc_data && (signal.smc_data.order_blocks?.length > 0 || signal.smc_data.bos_events?.length > 0);
  const hasVolumeData = signal.volume_data && Object.keys(signal.volume_data).length > 0;
  const hasSentimentData = signal.sentiment_data && Object.keys(signal.sentiment_data).length > 0;

  // If no deep dive data available, don't show the section
  if (!hasSmcData && !hasVolumeData && !hasSentimentData) {
    return null;
  }

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs font-semibold">PRO</Badge>
        <h3 className="font-semibold text-lg">Institutional Deep Dive</h3>
      </div>

      <Separator />

      {/* SMC Visualizer */}
      {hasSmcData && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h4 className="font-medium">Smart Money Concepts</h4>
          </div>

          {/* Order Blocks */}
          {signal.smc_data.order_blocks && signal.smc_data.order_blocks.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Order Blocks</p>
              <div className="grid gap-2">
                {signal.smc_data.order_blocks.slice(0, 5).map((block: any, index: number) => (
                  <div
                    key={index}
                    className="flex justify-between items-center p-3 rounded-md border"
                  >
                    <div className="flex items-center gap-2">
                      {block.direction === 'bullish' ? (
                        <TrendingUp className="h-4 w-4 text-green-600" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-600" />
                      )}
                      <span className="text-sm capitalize">{block.direction}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono">{block.price_range}</span>
                      <Badge
                        variant={block.status === 'active' ? 'default' : 'secondary'}
                        className="text-xs"
                      >
                        {block.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Break of Structure */}
          {signal.smc_data.bos_events && signal.smc_data.bos_events.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Break of Structure (BOS)</p>
              <div className="grid gap-2">
                {signal.smc_data.bos_events.slice(0, 3).map((bos: any, index: number) => (
                  <div
                    key={index}
                    className="flex justify-between items-center p-2 rounded-md bg-muted/50"
                  >
                    <span className="text-xs text-muted-foreground">{bos.time}</span>
                    <div className="flex items-center gap-2">
                      {bos.direction === 'up' ? (
                        <TrendingUp className="h-3 w-3 text-green-600" />
                      ) : (
                        <TrendingDown className="h-3 w-3 text-red-600" />
                      )}
                      <span className="text-sm font-mono">${bos.price?.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Structure Bias */}
          {signal.smc_data.structure_bias && (
            <div className="p-3 rounded-md bg-muted/30">
              <p className="text-xs text-muted-foreground">Structure Bias</p>
              <p className="text-sm font-medium capitalize mt-1">{signal.smc_data.structure_bias}</p>
            </div>
          )}
        </div>
      )}

      {hasSmcData && (hasVolumeData || hasSentimentData) && <Separator />}

      {/* Volume Data */}
      {hasVolumeData && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            <h4 className="font-medium">Volume Analysis</h4>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {signal.volume_data.relative_volume && (
              <div className="p-3 rounded-md border">
                <p className="text-xs text-muted-foreground mb-1">Relative Volume</p>
                <p className="text-lg font-semibold font-mono">
                  {signal.volume_data.relative_volume.toFixed(2)}x
                </p>
              </div>
            )}

            {signal.volume_data.trend && (
              <div className="p-3 rounded-md border">
                <p className="text-xs text-muted-foreground mb-1">Trend</p>
                <p className="text-sm font-medium capitalize">{signal.volume_data.trend}</p>
              </div>
            )}

            {signal.volume_data.order_flow_bias && (
              <div className="p-3 rounded-md border">
                <p className="text-xs text-muted-foreground mb-1">Order Flow</p>
                <p className="text-sm font-medium capitalize">{signal.volume_data.order_flow_bias}</p>
              </div>
            )}

            {signal.volume_data.vwap_distance !== undefined && (
              <div className="p-3 rounded-md border">
                <p className="text-xs text-muted-foreground mb-1">VWAP Distance</p>
                <p className="text-lg font-semibold font-mono">
                  {signal.volume_data.vwap_distance.toFixed(1)}%
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {hasVolumeData && hasSentimentData && <Separator />}

      {/* Sentiment Data */}
      {hasSentimentData && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-primary" />
            <h4 className="font-medium">Market Sentiment</h4>
          </div>

          <div className="grid grid-cols-3 gap-3">
            {signal.sentiment_data.overall && (
              <div className="p-3 rounded-md border text-center">
                <p className="text-xs text-muted-foreground mb-1">Overall</p>
                <Badge
                  variant={
                    signal.sentiment_data.overall === 'bullish'
                      ? 'default'
                      : signal.sentiment_data.overall === 'bearish'
                      ? 'destructive'
                      : 'secondary'
                  }
                  className="text-xs"
                >
                  {signal.sentiment_data.overall}
                </Badge>
              </div>
            )}

            {signal.sentiment_data.score !== undefined && (
              <div className="p-3 rounded-md border text-center">
                <p className="text-xs text-muted-foreground mb-1">Score</p>
                <p className="text-lg font-semibold font-mono">
                  {signal.sentiment_data.score > 0 ? '+' : ''}
                  {signal.sentiment_data.score}
                </p>
              </div>
            )}

            {signal.sentiment_data.news_count && (
              <div className="p-3 rounded-md border text-center">
                <p className="text-xs text-muted-foreground mb-1">Articles</p>
                <p className="text-lg font-semibold">{signal.sentiment_data.news_count}</p>
              </div>
            )}
          </div>

          {/* Headlines */}
          {signal.sentiment_data.headlines && signal.sentiment_data.headlines.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Recent Headlines</p>
              <div className="space-y-2">
                {signal.sentiment_data.headlines.slice(0, 3).map((headline: string, index: number) => (
                  <div
                    key={index}
                    className="flex items-start gap-2 p-2 rounded-md bg-muted/30"
                  >
                    <Newspaper className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-muted-foreground leading-relaxed">{headline}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Placeholder for Fundamentals & Macro (future enhancement) */}
      <Separator />
      <div className="text-center py-4 space-y-2">
        <div className="flex items-center justify-center gap-4 text-muted-foreground">
          <Building2 className="h-5 w-5" />
          <Globe className="h-5 w-5" />
        </div>
        <p className="text-xs text-muted-foreground">
          Fundamentals & Macro analysis coming soon
        </p>
      </div>
    </Card>
  );
}
