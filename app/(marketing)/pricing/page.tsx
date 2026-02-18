'use client'

import type { Metadata } from 'next'
import { useEffect, useState } from 'react'
import { useAccess } from '@/lib/useAccess'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Check, Activity, Shield, BarChart3, Eye } from 'lucide-react'

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
  },
  alternates: {
    canonical: 'https://marild.com/pricing',
  },
};

export default function PricingPage() {
  const access = useAccess()
  const router = useRouter()
  const target = '/dashboard'
  const [loading] = useState(false)

  // If already PRO, go straight to target
  useEffect(() => {
    if (access?.is_logged_in && access.is_pro) {
      router.replace(target)
    }
  }, [access, target, router])

  const handlePrimaryCTA = async () => {
    if (!access || !access.is_logged_in) {
      router.push('/signup')
      return
    }
    if (!access.is_pro) {
      router.push('/billing')
      return
    }
    router.push('/dashboard')
  }

return (
    <div className="relative min-h-screen text-foreground overflow-hidden bg-[radial-gradient(circle_at_top_center,#0f2f2a_0%,#0a0f12_55%)]">
      {/* Ambient animated gradient */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-[60rem] w-[60rem] rounded-full bg-[conic-gradient(at_50%_50%,#0d3b35_0%,#116a5a_25%,#0b2430_50%,#0d3b35_100%)] blur-3xl animate-slow-gradient" />
      </div>

      <div className="mx-auto max-w-[1100px] px-4 py-20 space-y-12 relative">
        {/* Hero */}
        <section className="text-center space-y-4 animate-fade-up">
          <h1 className="text-4xl sm:text-5xl font-bold">Simple pricing. Built for serious traders.</h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            One plan. Full access. Real portfolios. Cancel anytime.
          </p>
        </section>

{/* A) Context Framing */}
        <section className="animate-fade-up [animation-delay:80ms] mx-auto max-w-[1100px]">
          <div className="rounded-2xl border border-emerald-500/20 bg-white/5 backdrop-blur-md p-6 md:p-8 relative overflow-hidden">
            <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-emerald-500/10" />
            <div className="absolute -inset-px rounded-2xl bg-gradient-to-r from-emerald-600/10 to-blue-600/10" />
            <div className="relative space-y-4">
              <h2 className="text-xl font-semibold">Not your typical signal service.</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Yes, we provide signals — but with <span className="font-semibold text-foreground">full transparency</span>. Every signal is tracked in a live model portfolio. Every trade is logged — wins <span className="italic">and</span> losses. Nothing is hidden. You see exactly which signals worked and which didn&apos;t, proving or disproving our system in real-time.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { icon: Shield, text: 'A live, rules-based trading engine' },
                  { icon: BarChart3, text: 'A real model portfolio with tracked equity' },
                  { icon: Activity, text: 'Risk-managed execution logic' },
                  { icon: Eye, text: 'Ongoing research and engine refinement' },
                ].map((f, i) => {
                  const Icon = f.icon
                  return (
                    <div key={i} className="flex items-center gap-2 rounded-lg border border-emerald-500/10 bg-background/40 px-3 py-2">
                      <Icon className="h-4 w-4 text-emerald-400" />
                      <span className="text-sm text-muted-foreground leading-snug">{f.text}</span>
                    </div>
                  )
                })}
              </div>
              <p className="text-xs text-muted-foreground italic">
                No cherry-picked screenshots. No deleted losing trades. No hidden performance. Just honest results — proven or disproven daily.
              </p>
            </div>
          </div>
        </section>

{/* B) Primary Price Card */}
        <section className="animate-fade-up [animation-delay:160ms] mx-auto max-w-[1100px]">
          <Card className="mx-auto max-w-[700px] p-8 sm:p-10 border-emerald-500/30 bg-[linear-gradient(180deg,#0b1417_0%,#0e1b22_100%)] shadow-[0_0_40px_-20px_rgba(16,185,129,0.5)] transition-all duration-300 will-change-transform hover:-translate-y-1 hover:shadow-emerald-500/30">
            <div className="relative">
<div className="absolute -top-3 left-0 right-0 mx-auto w-max text-xs text-emerald-400">🟢 Live portfolio running</div>
            </div>
            <div className="text-center space-y-2 mb-6">
              <h3 className="text-2xl font-semibold">Professional Plan</h3>
              <p className="text-sm text-muted-foreground">Full access to live signals, model portfolio, and performance tracking</p>
            </div>
            <div className="text-center space-y-1 mb-6">
              <div className="text-5xl font-bold">$69 <span className="text-xl text-muted-foreground">/ month</span></div>
<div className="text-xs text-muted-foreground">Less than one average stop-loss — per month.</div>
            </div>
            <ul className="mx-auto max-w-xl space-y-2 mb-8 text-sm">
{[
              '✔ Live AI signals (entry, SL, TP1, TP2) posted hourly',
              '✔ $100K model portfolio proving every signal in real-time',
              '✔ Live equity curve with honest drawdowns',
              '✔ Every trade logged (wins and losses)',
              '✔ Smart Money Concepts (SMC) analysis on each signal',
              '✔ Risk-managed position sizing (0.75% per trade)',
              '✔ 50+ approved tickers scanned hourly',
              '✔ Web dashboard + Discord signal alerts',
              '✔ Continuous engine improvements based on live results',
            ].map((t, i) => (
                <li key={i} className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-emerald-400 scale-95 data-[animate=true]:scale-100 transition-transform" data-animate />
                  <span className="text-muted-foreground">{t}</span>
                </li>
              ))}
            </ul>
            <div className="text-center space-y-2">
              <Button
                size="lg"
                className="px-8 bg-emerald-600 hover:bg-emerald-500 transition-all shadow-[0_0_0_0_rgba(16,185,129,0.0)] hover:shadow-[0_0_20px_0_rgba(16,185,129,0.35)]"
                onClick={handlePrimaryCTA}
                disabled={loading}
              >
{loading ? 'Loading…' : 'Get Full Access'}
</Button>
              <div className="text-xs text-muted-foreground">No contracts. Cancel anytime.</div>
            </div>
          </Card>
        </section>

{/* C1) Proof & Reassurance */}
        <section className="animate-fade-up [animation-delay:240ms] mx-auto max-w-[1100px]">
          <h3 className="text-xl font-semibold mb-2 text-center">What you&apos;ll see inside Marild</h3>
          <p className="text-sm text-muted-foreground text-center mb-6 max-w-2xl mx-auto">
            Full transparency means you can verify everything. No smoke and mirrors.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              { title: 'Live Signals', desc: 'Entry, SL, TP1, TP2 posted hourly with SMC analysis' },
              { title: 'Model Portfolio', desc: '$100K paper portfolio executing every signal to prove results' },
              { title: 'Complete Trade Log', desc: 'Every entry, exit, P&L - wins AND losses' },
              { title: 'Honest Drawdowns', desc: 'Real-time equity curve with all losing periods shown' },
              { title: 'Position Tracking', desc: 'Open positions with live P&L and risk management' },
              { title: 'Performance Metrics', desc: 'Win rate, expectancy, profit factor - all verifiable' },
            ].map((item, i) => (
              <div key={i} className="rounded-lg border border-emerald-500/10 bg-[linear-gradient(180deg,#0b1417_0%,#0e1b22_100%)] p-4 transition-transform duration-200 hover:-translate-y-1 hover:shadow-lg">
                <div className="flex items-start gap-3">
                  <Check className="h-5 w-5 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <div className="font-medium text-sm text-foreground mb-1">{item.title}</div>
                    <div className="text-xs text-muted-foreground leading-relaxed">{item.desc}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

{/* C2) What we don’t do */}
        <section className="animate-fade-up [animation-delay:320ms] mx-auto max-w-[1100px]">
          <div className="rounded-lg border-l-4 pl-4 md:pl-6 py-4 border-transparent bg-[#0b1215]">
            <div className="-ml-4 md:-ml-6 w-1 h-full bg-gradient-to-b from-red-500/40 to-amber-400/40 absolute" />
            <h3 className="text-xl font-semibold mb-3">What we don’t do</h3>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>• No hindsight backtests sold as promises</li>
              <li>• No cherry-picked trade screenshots</li>
              <li>• No manual trade deletion</li>
              <li>• No profit guarantees</li>
              <li>• No influencer performance claims</li>
            </ul>
          </div>
        </section>

{/* C3) Quick Pricing Questions - Keep short, link to full FAQ */}
        <section className="animate-fade-up [animation-delay:400ms] pb-12 mx-auto max-w-[900px]">
          <h3 className="text-xl font-semibold mb-2 text-center">Quick Questions</h3>
          <p className="text-sm text-muted-foreground text-center mb-4">
            Have more questions? <a href="/faq" className="text-emerald-400 hover:text-emerald-300 underline">Visit our full FAQ</a>
          </p>
          <div className="space-y-2">
            {[
              { q: 'Is there a free trial?', a: 'No. Marild provides full transparency of live results instead of short-term trials that don\'t prove long-term edge.' },
              { q: 'Can I cancel anytime?', a: 'Yes. You can cancel your subscription at any time. No contracts, no commitments.' },
              { q: 'Is the model portfolio a real account?', a: 'No, it\'s a paper-traded portfolio that executes every signal to prove results. This shows exactly what would happen if you followed our signals.' },
              { q: 'Who is this for?', a: 'Serious traders who want proven signals with full transparency — not get-rich-quick schemes or unverified performance claims.' },
            ].map((item, i) => (
              <details key={i} className="group rounded-lg border border-foreground/5 bg-[#0e171a]">
                <summary className="cursor-pointer list-none px-4 py-3 text-sm text-muted-foreground group-open:text-foreground">
                  {item.q}
                </summary>
                <div className="px-4 pb-4 text-sm text-muted-foreground/90">{item.a}</div>
              </details>
            ))}
          </div>
        </section>

<style jsx global>{`
          @media (prefers-reduced-motion: no-preference) {
            .animate-fade-up { opacity: 0; transform: translateY(12px); animation: fadeUp 700ms ease forwards; }
            .animate-slow-gradient { animation: slowGradient 24s ease-in-out infinite alternate; }
          }
          @keyframes fadeUp { to { opacity: 1; transform: translateY(0); } }
          @keyframes slowGradient { 0% { transform: translate(-10%, -10%) rotate(0deg); } 100% { transform: translate(10%, 10%) rotate(180deg); } }
        `}</style>
      </div>
    </div>
  )
}
