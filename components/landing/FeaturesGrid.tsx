import { Brain, Layers3, ShieldCheck, Newspaper, Activity, Smartphone } from "lucide-react"
import { FeatureCard } from "@/components/ui/FeatureCard"
import { SectionHeader } from "@/components/ui/SectionHeader"

const features = [
  {
    title: "AI Signals",
    description: "Full 9-step analysis pipeline combining price action, volume, structure, and risk filters.",
    icon: Brain,
  },
  {
    title: "Smart Money Concepts",
    description: "Order blocks, liquidity zones, FVGs and market structure mapped onto every signal.",
    icon: Layers3,
  },
  {
    title: "Market Correction Risk",
    description: "Proprietary daily risk score that tracks corrections, volatility spikes, and regime shifts.",
    icon: ShieldCheck,
  },
  {
    title: "Automated News Scanning",
    description: "Realtime news stream with sentiment and relevance scoring tied directly to your watchlist.",
    icon: Newspaper,
  },
  {
    title: "Volume & Technicals",
    description: "Trend, momentum, volume profile, and volatility tools in one clean view.",
    icon: Activity,
  },
  {
    title: "Multi-Channel Access",
    description: "Use TradeLens in the web app and in Discord — same signals, same engine.",
    icon: Smartphone,
  },
]

export function FeaturesGrid() {
  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          align="center"
          eyebrow="What makes TradeLens different"
          title="Signals built for serious decision-making"
          subtitle="Everything in TradeLens is designed to answer one question: should I actually put risk on here?"
          className="mb-10 sm:mb-12"
        />

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <FeatureCard
              key={feature.title}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
