import Link from "next/link"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionHeader } from "@/components/ui/SectionHeader"
import { ScreenshotPlaceholder } from "@/components/ui/ScreenshotPlaceholder"

export function SignalsShowcase() {
  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 sm:px-6 lg:flex-row lg:items-center lg:gap-16 lg:px-8">
        <div className="flex flex-1 flex-col gap-4">
          <div className="relative max-w-md">
            <ScreenshotPlaceholder
              className="h-40"
              label="AI Signal card preview"
            />
            <div className="-bottom-6 -right-6 hidden max-w-xs rounded-3xl bg-white/90 p-4 shadow-lg ring-1 ring-slate-200 sm:absolute sm:block">
              <p className="mb-1 text-xs font-semibold text-slate-500">BTCUSD • 4H AI Signal</p>
              <p className="mb-2 text-sm font-semibold text-slate-900">Long bias, SMC-aligned</p>
              <p className="text-xs text-slate-600">
                Entry, SL, TP1/TP2 with confidence and risk context. Auto-posted to Discord.
              </p>
            </div>
          </div>
        </div>

        <div className="flex-1">
          <SectionHeader
            eyebrow="Signals"
            title="AI signals that actually make sense"
            subtitle="Every signal runs through the same structured pipeline: SMC, volume, sentiment, and fundamentals. No black box magic, just transparent context."
            className="mb-6"
          />

          <ul className="mb-6 space-y-3 text-sm text-slate-700">
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-[#0AAE84]" />
              <span>Smart Money Concepts, volume, sentiment, and fundamentals in one view.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-[#0AAE84]" />
              <span>Clear entries, stop loss, TP1/TP2 levels, and confidence scoring.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-[#0AAE84]" />
              <span>Signals auto-posted to Discord channels for teams and communities.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-[#0AAE84]" />
              <span>Built to complement, not replace, your own process.</span>
            </li>
          </ul>

          <Button asChild size="lg" className="rounded-full bg-slate-900 text-white hover:bg-slate-800">
            <Link href="/dashboard">Explore Signals</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
