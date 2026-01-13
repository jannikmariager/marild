'use client';

import { Card } from '@/components/ui/card';

interface SummaryCardProps {
  summary: string;
}

export function SummaryCard({ summary }: SummaryCardProps) {
  return (
    <Card className="p-5 space-y-4">
      <p className="text-muted-foreground leading-relaxed">{summary}</p>
      <div className="border-t pt-4">
        <p className="text-xs text-muted-foreground italic">
          ⚠️ Not financial advice. Trading involves risk. You are solely responsible for your trading decisions.
        </p>
      </div>
    </Card>
  );
}
