"use client"

import { useRouter } from "next/navigation"
import { useAccess } from "@/lib/useAccess"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { SectionHeader } from "@/components/ui/SectionHeader"

const proFeatures = [
  "One unified signal stream—no strategy switching",
  "Real model portfolio with tracked equity",
  "Signal confidence scoring & structure validation",
  "Every entry, exit, stop, and target logged",
  "Live equity curve & transparent drawdowns",
  "Volatility-aware position sizing",
  "Signals appear only when conditions align",
  "Web dashboard + Discord alerts",
];

export function Pricing() {
  const access = useAccess();
  const router = useRouter();

  const handlePrimaryCTA = async () => {
    if (!access || !access.is_logged_in) {
      router.push('/signup');
      return;
    }
    if (access.is_pro) {
      router.push('/dashboard');
      return;
    }
    // Logged in but not subscribed → /billing (Checkout)
    router.push('/billing');
  };

  return (
    <section id="pricing" className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <SectionHeader
          align="center"
          eyebrow="Live Portfolio • Pro Access"
          title="Pro Access"
          subtitle="One plan. Full access. Cancel anytime."
          className="mb-10 sm:mb-12"
        />

        <div className="rounded-[26px] bg-gradient-to-r from-[#0AAE84] to-[#4F3BCE] p-[1px] shadow-[0_18px_40px_rgba(15,23,42,0.18)]">
          <Card className="h-full rounded-[24px] border-0 bg-white">
            <CardHeader className="px-6 pb-3 pt-6">
              <CardTitle className="text-base font-semibold text-slate-900">$69 <span className="text-xs text-slate-500">/ month</span></CardTitle>
              <CardDescription className="text-sm text-slate-600">
                Less than one average stop-loss — per month.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6 pb-6">
              <h3 className="mb-3 text-sm font-semibold text-slate-900">What Pro Access Unlocks</h3>
              <ul className="mb-6 space-y-2 text-sm text-slate-700">
                {proFeatures.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 text-[#0AAE84]" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <Button
                size="lg"
                className="w-full rounded-full bg-[#0AAE84] text-white hover:bg-[#08956F]"
                onClick={handlePrimaryCTA}
              >
                Get Pro Access
              </Button>
              <p className="mt-3 text-center text-xs text-slate-500">
                No trials. No gimmicks. Real performance only.
              </p>
              <p className="mt-6 text-center text-[11px] text-slate-500">
                Signal intelligence system. Full transparency. No artificial timeframes.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  )
}
