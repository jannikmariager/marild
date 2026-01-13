"use client";

import { mockSignals } from "@/lib/mockData";
import { SignalFlipCard } from "./SignalFlipCard";

export function SignalQualitySection() {
  return (
    <section className="py-24 relative">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold mb-4">
            Every Signal Graded. Zero Guessing.
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Full context, risk scoring, and SMC alignment for every trade opportunity
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl mx-auto">
          {mockSignals.map((signal) => (
            <SignalFlipCard key={signal.id} signal={signal} />
          ))}
        </div>
        
        <div className="text-center mt-12">
          <p className="text-sm text-muted-foreground">
            Hover over any card to see full signal context and risk analysis
          </p>
        </div>
      </div>
    </section>
  );
}
