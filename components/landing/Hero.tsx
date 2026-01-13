import Link from "next/link"
import Image from "next/image"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScreenshotPlaceholder } from "@/components/ui/ScreenshotPlaceholder"

function HeroMockup() {
  return (
    <div className="w-full max-w-xl">
      <ScreenshotPlaceholder
        className="h-64 sm:h-80 lg:h-96"
        label="Dashboard preview"
      />
    </div>
  )
}

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-[#F7F9FA]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -right-24 h-72 w-72 rounded-full bg-[radial-gradient(circle_at_top,_rgba(127,84,255,0.16),_transparent_60%)]" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-[radial-gradient(circle_at_bottom,_rgba(10,174,132,0.18),_transparent_60%)]" />
      </div>

      <div className="relative mx-auto flex max-w-6xl flex-col gap-12 px-4 pb-16 pt-20 sm:px-6 sm:pt-24 lg:flex-row lg:items-center lg:gap-16 lg:px-8 lg:pb-24">
        <div className="max-w-xl space-y-8">
          <div className="flex items-center gap-4 mb-6">
            <Image 
              src="/marild-icon.svg" 
              alt="Marild" 
              width={48} 
              height={48}
              className="w-12 h-12"
            />
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-3 py-1 text-xs font-medium text-slate-600 shadow-sm ring-1 ring-slate-200">
            <span className="inline-flex h-2 w-2 rounded-full bg-[#0AAE84]" />
            <span>Signal intelligence. No guesswork.</span>
          </div>

          <div className="space-y-4">
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl lg:text-5xl">
              High-Confidence Market Signals.
              <br className="hidden sm:block" />
              <span className="bg-gradient-to-r from-[#7F54FF] to-[#4F3BCE] bg-clip-text text-transparent">
                Let the Market Decide the Timing.
              </span>
            </h1>
            <p className="text-base leading-relaxed text-slate-600 sm:text-lg">
              Marild identifies high-quality market opportunities using structure, volatility, and momentum—without forcing trades into artificial timeframes.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button asChild size="lg" className="rounded-full bg-[#0AAE84] text-white hover:bg-[#08956F]">
              <Link href="/signup">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full border-slate-200 bg-white text-slate-900 hover:bg-slate-50"
            >
              <Link href="/login">Login</Link>
            </Button>
          </div>

          <p className="text-xs text-slate-500">
            One unified signal engine. Transparent performance tracking. No artificial timeframes.
          </p>
        </div>

        <div className="flex flex-1 justify-center lg:justify-end">
          <HeroMockup />
        </div>
      </div>
    </section>
  )
}
