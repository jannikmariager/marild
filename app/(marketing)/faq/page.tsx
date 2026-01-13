import { FAQSection } from "@/components/landing/FAQSection";
import { LandingFooter } from "@/components/landing/LandingFooter";

export default function FAQPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <FAQSection />
      <LandingFooter />
    </div>
  );
}
