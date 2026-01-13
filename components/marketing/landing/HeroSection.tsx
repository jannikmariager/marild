"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight, BarChart3 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDashboardTransition } from "@/components/DashboardTransitionProvider";
import { LivePortfolioWidget } from "./LivePortfolioWidget";
import { useAccess } from "@/lib/useAccess";

export function HeroSection() {
  const router = useRouter();
  const { startDashboardTransition } = useDashboardTransition();
  const access = useAccess();
  const webappUrl = process.env.NEXT_PUBLIC_WEBAPP_URL || "http://localhost:3000";

  const targetForAccess = () => {
    if (!access) return "/signup";
    if (!access.is_logged_in) return "/signup";
    if (!access.is_pro) return "/pricing?plan=pro";
    return `${webappUrl}/dashboard`;
  };

  const handleViewPerformance = (e: React.MouseEvent) => {
    e.preventDefault();
    startDashboardTransition();
    router.push(targetForAccess());
  };

  return (
    <section className="relative min-h-[90vh] flex items-center overflow-hidden">
      
      <div className="container mx-auto px-4 py-20 relative z-10">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          {/* Left side - Content */}
          <div className="space-y-8 animate-fade-in-up">
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-medium">Structure-Driven Signal Intelligence</span>
            </div>
            
            <h1 className="text-5xl lg:text-6xl xl:text-7xl font-bold leading-tight tracking-tight">
              Signals That Adapt to{" "}
              <span className="bg-gradient-to-r from-emerald-500 to-emerald-300 bg-clip-text text-transparent">
                Market Conditions
              </span>
            </h1>
            
            <p className="text-xl text-muted-foreground leading-relaxed max-w-2xl">
              When market conditions align, Marild surfaces high-confidence signals. Some resolve quickly. Others take longer. The system adapts—you don&apos;t have to.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Link href="#" onClick={(e) => { e.preventDefault(); router.push(targetForAccess()); }}>
                <Button size="lg" className="gap-2 text-lg px-8 h-14 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 shadow-lg shadow-emerald-500/25">
                  Get Started
                  <ArrowRight className="w-5 h-5" />
                </Button>
              </Link>
              
              <Link href="#" onClick={handleViewPerformance}>
                <Button size="lg" variant="outline" className="gap-2 text-lg px-8 h-14 border-2 hover:bg-accent/50">
                  <BarChart3 className="w-5 h-5" />
                  View Live Signals
                </Button>
              </Link>
            </div>
            
            {/* Trust indicators */}
            <div className="flex flex-wrap gap-6 pt-8 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-emerald-500" />
                <span>Signal Confidence Scoring</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1 h-1 rounded-full bg-emerald-500" />
                <span>Volatility-Aware Entries</span>
              </div>
            </div>
          </div>
          
          {/* Right side - Live Widget */}
          <div className="animate-fade-in-up animation-delay-200">
            <LivePortfolioWidget />
          </div>
        </div>
      </div>
    </section>
  );
}
