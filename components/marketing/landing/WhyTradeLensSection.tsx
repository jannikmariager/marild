"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Brain, Eye, Shield } from "lucide-react";

const features = [
  {
    icon: Brain,
    title: "Professional AI Pipeline",
    description: "9-layer analysis: SMC, trend, volume, volatility, sentiment, risk filters",
    gradient: "from-purple-500 to-purple-300",
  },
  {
    icon: Eye,
    title: "Full Transparency",
    description: "Every trade visible in real-time portfolios. See wins, losses, drawdowns, and benchmarks",
    gradient: "from-emerald-500 to-emerald-300",
  },
  {
    icon: Shield,
    title: "Institutional Risk Framework",
    description: "Market regime detection, volatility filters, daily risk scoring",
    gradient: "from-blue-500 to-blue-300",
  },
];

export function WhyTradeLensSection() {
  return (
    <section className="py-24 relative">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold mb-4">
Why Marild?
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Professional-grade trading intelligence built on transparency and institutional methods
          </p>
        </div>
        
        <div className="grid md:grid-cols-3 gap-8">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card
                key={feature.title}
                className="group relative overflow-hidden border-border/50 hover:border-border transition-all duration-300 hover:shadow-xl hover:-translate-y-1"
                style={{
                  animation: `fadeInUp 0.6s ease-out ${index * 0.1}s both`,
                }}
              >
                <CardHeader>
                  <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${feature.gradient} p-4 mb-4 group-hover:scale-110 transition-transform duration-300`}>
                    <Icon className="w-full h-full text-white" />
                  </div>
                  <CardTitle className="text-2xl">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </CardContent>
                
                {/* Hover gradient effect */}
                <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-300 pointer-events-none`} />
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
