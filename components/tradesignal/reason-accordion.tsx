'use client';

import { Card } from '@/components/ui/card';
import { Layers, Activity, BarChart3, MessageCircle, Briefcase, Globe2, Link2 } from 'lucide-react';

interface ReasonAccordionProps {
  signal: any;
}

export function ReasonAccordion({ signal }: ReasonAccordionProps) {
  const reasons = signal.reasons;

  // Handle both old array format and new object format
  const isObjectFormat = reasons && typeof reasons === 'object' && !Array.isArray(reasons);
  
  if (!reasons) {
    return null;
  }

  // If old array format, show simple list
  if (Array.isArray(reasons) || reasons.items) {
    const items = Array.isArray(reasons) ? reasons : reasons.items || [];
    return (
      <Card className="p-5">
        <h3 className="font-semibold text-lg mb-4">Analysis</h3>
        <ul className="space-y-2">
          {items.map((reason: string, index: number) => (
            <li key={index} className="text-sm flex items-start space-x-2">
              <span className="text-primary mt-1">•</span>
              <span className="text-muted-foreground">{reason}</span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  // New institutional AI format with structured reasons
  if (!isObjectFormat) {
    return null;
  }

  const factorOrder = [
    { key: 'smc', label: 'SMC', icon: Layers },
    { key: 'price_action', label: 'Price Action', icon: Activity },
    { key: 'volume', label: 'Volume', icon: BarChart3 },
    { key: 'sentiment', label: 'Sentiment', icon: MessageCircle },
    { key: 'fundamentals', label: 'Fundamentals', icon: Briefcase },
    { key: 'macro', label: 'Macro', icon: Globe2 },
    { key: 'confluence', label: 'AI + Confluence', icon: Link2 },
  ];

  return (
    <Card className="p-5">
      <h3 className="font-semibold text-lg mb-4">Multi-Factor Analysis</h3>
      <div className="space-y-4">
        {factorOrder.map(({ key, label, icon: Icon }) => {
          const content = reasons[key];
          if (!content || typeof content !== 'string') return null;

          return (
            <div key={key} className="border-b last:border-b-0 pb-4 last:pb-0">
              <div className="flex items-center gap-2 mb-1">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium text-sm">{label}</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {content}
              </p>

              {/* Inline factor confidence for key factors, similar to Discord but more compact */}
              {key === 'smc' && signal.smc_confidence && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Factor confidence: <span className="font-mono font-semibold">{signal.smc_confidence.toFixed(0)}%</span>
                </div>
              )}
              {key === 'volume' && signal.volume_confidence && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Factor confidence: <span className="font-mono font-semibold">{signal.volume_confidence.toFixed(0)}%</span>
                </div>
              )}
              {key === 'sentiment' && signal.sentiment_confidence && (
                <div className="mt-2 text-xs text-muted-foreground">
                  Factor confidence: <span className="font-mono font-semibold">{signal.sentiment_confidence.toFixed(0)}%</span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Show factor confidence breakdown */}
      {(signal.smc_confidence || signal.volume_confidence || signal.sentiment_confidence) && (
        <div className="mt-4 pt-4 border-t">
          <h4 className="text-xs font-medium text-muted-foreground mb-2">Factor Confidence Scores</h4>
          <div className="flex flex-wrap gap-2">
            {signal.smc_confidence && (
              <div className="px-3 py-1 rounded-md bg-muted text-xs">
                <span className="text-muted-foreground">SMC:</span>{' '}
                <span className="font-mono font-semibold">{signal.smc_confidence.toFixed(0)}%</span>
              </div>
            )}
            {signal.volume_confidence && (
              <div className="px-3 py-1 rounded-md bg-muted text-xs">
                <span className="text-muted-foreground">Volume:</span>{' '}
                <span className="font-mono font-semibold">{signal.volume_confidence.toFixed(0)}%</span>
              </div>
            )}
            {signal.sentiment_confidence && (
              <div className="px-3 py-1 rounded-md bg-muted text-xs">
                <span className="text-muted-foreground">Sentiment:</span>{' '}
                <span className="font-mono font-semibold">{signal.sentiment_confidence.toFixed(0)}%</span>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
