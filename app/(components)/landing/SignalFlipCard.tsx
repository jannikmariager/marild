"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, AlertCircle } from "lucide-react";

interface SignalFlipCardProps {
  signal: {
    ticker: string;
    confidence: number;
    smcAlignment: string;
    trendContext: string;
    entry: number;
    sl: number;
    tp1: number;
    tp2: number;
    volumeConfirmation: boolean;
    marketRisk: string;
  };
}

export function SignalFlipCard({ signal }: SignalFlipCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  
  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 85) return "text-emerald-500 border-emerald-500/30 bg-emerald-500/10";
    if (confidence >= 75) return "text-blue-500 border-blue-500/30 bg-blue-500/10";
    return "text-yellow-500 border-yellow-500/30 bg-yellow-500/10";
  };
  
  const getRiskColor = (risk: string) => {
    if (risk === "Low") return "bg-emerald-500/20 text-emerald-500";
    if (risk === "Medium") return "bg-yellow-500/20 text-yellow-500";
    return "bg-red-500/20 text-red-500";
  };
  
  return (
    <div
      className="relative h-[300px] cursor-pointer perspective-1000"
      onClick={() => setIsFlipped(!isFlipped)}
      onMouseEnter={() => setIsFlipped(true)}
      onMouseLeave={() => setIsFlipped(false)}
    >
      <div
        className={`relative w-full h-full transition-transform duration-500 transform-style-3d ${
          isFlipped ? "rotate-y-180" : ""
        }`}
      >
        {/* Front */}
        <Card className={`absolute inset-0 p-6 backface-hidden border-2 ${getConfidenceColor(signal.confidence)}`}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <h3 className="text-2xl font-bold mb-1">{signal.ticker}</h3>
              <Badge variant="outline" className="text-xs">
                {signal.trendContext}
              </Badge>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold">{signal.confidence}</div>
              <div className="text-xs text-muted-foreground">Confidence</div>
            </div>
          </div>
          
          <div className="space-y-3 mt-6">
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Entry</span>
              <span className="text-lg font-semibold">${signal.entry.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Stop Loss</span>
              <span className="text-lg font-semibold text-red-500">${signal.sl.toFixed(2)}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">TP1 / TP2</span>
              <span className="text-lg font-semibold text-emerald-500">
                ${signal.tp1.toFixed(2)} / ${signal.tp2.toFixed(2)}
              </span>
            </div>
          </div>
          
          <div className="absolute -top-3 right-4 text-xs text-foreground/80 pointer-events-none">
            <span className="inline-flex items-center gap-1 rounded-full bg-background/90 px-3 py-1 shadow-sm">
              Hover for details →
            </span>
          </div>
        </Card>
        
        {/* Back */}
        <Card className="absolute inset-0 p-6 backface-hidden rotate-y-180 border-2 border-purple-500/30 bg-purple-500/5 overflow-auto">
          <h4 className="text-lg font-semibold mb-4">Signal Context</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">SMC Alignment</div>
                <Badge variant="outline" className="text-sm">
                  {signal.smcAlignment}
                </Badge>
              </div>
              
              <div>
                <div className="text-xs text-muted-foreground mb-1">Volume Confirmation</div>
                <div className="flex items-center gap-2">
                  {signal.volumeConfirmation ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-red-500" />
                  )}
                  <span className="text-sm">{signal.volumeConfirmation ? "Confirmed" : "Not Confirmed"}</span>
                </div>
              </div>
              
              <div>
                <div className="text-xs text-muted-foreground mb-1">Market Risk</div>
                <Badge className={`${getRiskColor(signal.marketRisk)} border-0`}>
                  {signal.marketRisk}
                </Badge>
              </div>
            </div>

            <div className="space-y-3 border-t md:border-t-0 md:border-l border-border pt-4 md:pt-0 md:pl-4">
              <div className="text-xs text-muted-foreground mb-2">Risk Factors</div>
              <ul className="text-sm space-y-2">
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-emerald-500" />
                  <span>SMC structure aligned</span>
                </li>
                <li className="flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-emerald-500" />
                  <span>Trend confirmation</span>
                </li>
                {!signal.volumeConfirmation && (
                  <li className="flex items-center gap-2">
                    <AlertCircle className="w-3 h-3 text-yellow-500" />
                    <span className="text-yellow-500">Low volume</span>
                  </li>
                )}
              </ul>
            </div>
          </div>
        </Card>
      </div>
      
      <style jsx>{`
        .perspective-1000 {
          perspective: 1000px;
        }
        .transform-style-3d {
          transform-style: preserve-3d;
        }
        .backface-hidden {
          backface-visibility: hidden;
        }
        .rotate-y-180 {
          transform: rotateY(180deg);
        }
      `}</style>
    </div>
  );
}
