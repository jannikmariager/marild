import Link from "next/link"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SectionHeader } from "@/components/ui/SectionHeader"
import { ScreenshotPlaceholder } from "@/components/ui/ScreenshotPlaceholder"

export function PerformanceEngineShowcase() {
  return (
    <section className="bg-[#F9FBFD] py-16 sm:py-20">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 sm:px-6 lg:flex-row lg:items-center lg:gap-16 lg:px-8">
        <div className="order-2 flex-1 lg:order-1">
          <SectionHeader
            eyebrow="Performance engine"
            title="Track performance like a professional"
            subtitle="Every signal, every exit, every drawdown — tracked with the same discipline as a professional desk."
            className="mb-6"
          />

          <ul className="mb-6 space-y-3 text-sm text-slate-700">
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-[#0AAE84]" />
              <span>Strategy vs benchmark curves for every signal set.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-[#0AAE84]" />
              <span>Win rate, profit factor, and distribution of returns.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-[#0AAE84]" />
              <span>Max drawdown and underwater curves to keep risk honest.</span>
            </li>
            <li className="flex items-start gap-2">
              <Check className="mt-0.5 h-4 w-4 text-[#0AAE84]" />
              <span>Best/worst trades and TP hit rate for every strategy.</span>
            </li>
          </ul>

          <Button asChild size="lg" className="rounded-full bg-slate-900 text-white hover:bg-slate-800">
            <Link href="/dashboard">View Performance Dashboard</Link>
          </Button>
        </div>

        <div className="order-1 flex flex-1 justify-center lg:order-2 lg:justify-end">
          <div className="w-full max-w-md space-y-4">
            <ScreenshotPlaceholder
              className="h-40"
              label="Equity curve and benchmark preview"
            />
            <ScreenshotPlaceholder
              className="h-28"
              label="Performance stats grid preview"
            />
          </div>
        </div>
      </div>
    </section>
  )
}
