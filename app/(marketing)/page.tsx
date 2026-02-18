import type { Metadata } from "next";
import { HeroSection } from "@/components/landing/HeroSection";
import { WhyTradeLensSection } from "@/components/landing/WhyTradeLensSection";
import { LivePerformanceSection } from "@/components/landing/LivePerformanceSection";
import { SignalQualitySection } from "@/components/landing/SignalQualitySection";
import { SMCVisualizerSection } from "@/components/landing/SMCVisualizerSection";
import { ProPlanSection } from "@/components/landing/ProPlanSection";
import { EducationalSection } from "@/components/landing/EducationalSection";
import { CommunitySection } from "@/components/landing/CommunitySection";
import { LandingFooter } from "@/components/landing/LandingFooter";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
  },
  alternates: {
    canonical: "https://marild.com/",
  },
};

export default function Home() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <HeroSection />
      <WhyTradeLensSection />
      <LivePerformanceSection />
      <SignalQualitySection />
      <SMCVisualizerSection />
      <ProPlanSection />
      <EducationalSection />
      <CommunitySection />
      <LandingFooter />
    </div>
  );
}
