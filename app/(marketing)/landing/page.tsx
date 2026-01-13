import { HeroSection } from "@/components/landing/HeroSection";
import { WhyTradeLensSection } from "@/components/landing/WhyTradeLensSection";
import { LivePerformanceSection } from "@/components/landing/LivePerformanceSection";
import { SignalQualitySection } from "@/components/landing/SignalQualitySection";
import { SMCVisualizerSection } from "@/components/landing/SMCVisualizerSection";
import { ProPlanSection } from "@/components/landing/ProPlanSection";
import { EducationalSection } from "@/components/landing/EducationalSection";
import { CommunitySection } from "@/components/landing/CommunitySection";
import { LandingFooter } from "@/components/landing/LandingFooter";

export default function LandingPage() {
  return (
    <div className="min-h-screen">
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
