"use client";

import { mockSignals } from "@/lib/mockData";
import { SignalFlipCard } from "./SignalFlipCard";

export function SignalQualitySection() {
  return (
    <section className="py-24 relative">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16 space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-4 py-1 text-sm font-medium text-emerald-300">
            Signal Intelligence Showcase
          </div>
          <h2 className="text-4xl lg:text-5xl font-bold">
            Every Signal Graded. Zero Guessing.
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Full context, risk scoring, and SMC alignment for every trade opportunity.
          </p>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
            The cards below are representative examples to illustrate how Marild scores signals.
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
