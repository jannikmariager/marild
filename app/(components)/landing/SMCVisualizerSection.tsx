"use client";

import { Card } from "@/components/ui/card";
import { BarChart3, Droplet, ScanLine, Zap, BarChart2, Target } from "lucide-react";

const features = [
  {
    title: "Order Blocks",
    description: "Institutional accumulation/distribution zones",
    Icon: BarChart3,
  },
  {
    title: "Liquidity Zones",
    description: "Where smart money hunts stop losses",
    Icon: Droplet,
  },
  {
    title: "Fair Value Gaps",
    description: "Imbalance zones for retracement entries",
    Icon: ScanLine,
  },
  {
    title: "Displacement & MSS",
    description: "Momentum shifts and market structure breaks",
    Icon: Zap,
  },
  {
    title: "Volume Clusters",
    description: "High-conviction institutional activity",
    Icon: BarChart2,
  },
  {
    title: "Regime Detection",
    description: "Trend, range, or volatile market classification",
    Icon: Target,
  },
];

export function SMCVisualizerSection() {
  return (
    <section className="py-24 relative">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold mb-4">
            Structure Matters. We Show You Everything.
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Smart Money Concepts decoded and visualized for every signal
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto">
{features.map((feature, index) => (
            <Card
              key={feature.title}
              className="group relative overflow-hidden p-6 border-border/50 hover:border-emerald-500/50 transition-all duration-300 hover:shadow-xl hover:scale-105 cursor-pointer"
              style={{
                animation: `fadeInUp 0.6s ease-out ${index * 0.1}s both`,
              }}
            >
              <div className="relative z-10">
<div className="mb-4 group-hover:scale-110 transition-transform duration-300">
                  <feature.Icon className="h-8 w-8 text-emerald-400" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{feature.title}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">
                  {feature.description}
                </p>
              </div>
              
              {/* Animated gradient on hover */}
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/0 to-purple-500/0 group-hover:from-emerald-500/10 group-hover:to-purple-500/10 transition-all duration-300 pointer-events-none" />
              
              {/* Glow effect */}
              <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-purple-500 opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-300 -z-10" />
            </Card>
          ))}
        </div>
        
        <div className="text-center mt-12">
          <p className="text-muted-foreground">
            Every signal comes with full SMC context and multi-layer analysis
          </p>
        </div>
      </div>
    </section>
  );
}
