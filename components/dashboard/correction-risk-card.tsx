'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle } from 'lucide-react';

export function CorrectionRiskCard() {
  // TODO: Replace with real data
  const riskLevel = 42; // 0-100
  const riskLabel = riskLevel < 30 ? 'Low' : riskLevel < 70 ? 'Moderate' : 'High';
  const riskColor = riskLevel < 30 ? 'bg-green-500' : riskLevel < 70 ? 'bg-yellow-500' : 'bg-red-500';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <AlertTriangle className="h-5 w-5" />
          <span>Market Correction Risk</span>
        </CardTitle>
        <CardDescription>{riskLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span>Risk Level</span>
            <span className="font-medium">{riskLevel}/100</span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div 
              className={`h-full ${riskColor} transition-all`} 
              style={{ width: `${riskLevel}%` }} 
            />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Current market conditions suggest moderate correction risk based on volatility, sentiment, and technical indicators.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
