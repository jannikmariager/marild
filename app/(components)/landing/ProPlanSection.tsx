"use client";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check } from "lucide-react";
import { useAccess } from "@/lib/useAccess";
import { useRouter } from "next/navigation";

const features = [
  "One unified signal stream—no strategy switching",
  "Real model portfolio with tracked equity",
  "Signal confidence scoring & structure validation",
  "Every entry, exit, stop, and target logged",
  "Live equity curve & transparent drawdowns",
  "Volatility-aware position sizing",
  "Signals appear only when conditions align",
  "Web dashboard + Discord alerts + Marild App",
];

export function ProPlanSection() {
  const access = useAccess();
  const router = useRouter();

  const handleCTA = async () => {
    if (!access || !access.is_logged_in) {
      router.push('/signup');
      return;
    }
    if (access.is_pro) {
      router.push('/dashboard');
      return;
    }
    router.push('/billing');
  };

  return (
    <section className="py-24 relative overflow-hidden">
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center mb-16">
          <Badge variant="outline" className="mb-4">
            Live Portfolio • Pro Access
          </Badge>
          <h2 className="text-4xl lg:text-5xl font-bold mb-4">Pro Access</h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            One plan. Full access. Cancel anytime.
          </p>
        </div>
        
        <div className="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
          {/* Left - Features */}
          <div className="space-y-6">
            <h3 className="text-2xl font-semibold mb-6">What Pro Access Unlocks</h3>
            <div className="space-y-4">
              {features.map((feature, index) => (
                <div
                  key={feature}
                  className="flex items-start gap-3 group"
                  style={{ animation: `fadeInUp 0.5s ease-out ${index * 0.05}s both` }}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center group-hover:bg-emerald-500/30 transition-colors">
                      <Check className="w-4 h-4 text-emerald-500" />
                    </div>
                  </div>
                  <span className="text-lg">{feature}</span>
                </div>
              ))}
            </div>
            <div className="pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Signal intelligence system. Full transparency. No artificial timeframes. Web, Discord, and Marild App access included.
              </p>
            </div>
          </div>
          
          {/* Right - Pricing Card */}
          <Card className="relative overflow-hidden border-2 border-emerald-500/20 bg-gradient-to-br from-card via-card to-emerald-500/5 shadow-2xl">
            <div className="p-8">
              <div className="text-center mb-8 -mt-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                  <div className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                  </div>
                  <span>LIVE PORTFOLIO</span>
                </div>
                <h3 className="text-5xl font-bold mb-2">$69 <span className="text-3xl text-muted-foreground">/ month</span></h3>
                <p className="text-muted-foreground">Less than one average stop-loss — per month.</p>
              </div>
              
              <Button
                size="lg"
                className="w-full text-lg h-14 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 shadow-lg shadow-emerald-500/25"
                onClick={handleCTA}
              >
                Get Pro Access
              </Button>
              
              <p className="mt-4 text-center text-sm text-muted-foreground">
                No trials. No gimmicks. Real performance only.
              </p>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
}
