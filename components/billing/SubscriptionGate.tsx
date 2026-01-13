"use client";

import { ReactNode } from "react";
import { Lock } from "lucide-react";
import { useUser } from "@/components/providers/user-provider";
import { Button } from "@/components/ui/button";
import { getDevSubscriptionStatus } from "@/lib/subscription/devOverride";
import { UpgradeButton } from "@/components/billing/upgrade-button";
import { createClient } from "@/lib/supabaseBrowser";
import { usePathname, useRouter } from "next/navigation";

interface SubscriptionGateProps {
  children: ReactNode;
}

/**
 * Global subscription gate for the in-app experience.
 *
 * Behaviour:
 * - TRIAL / PRO: full access, no blocking (optionally add banners elsewhere).
 * - EXPIRED: blocks the dashboard & insights with a full-screen paywall.
 * - DEV_FORCE_PRO: never blocks (see devOverride helpers).
 */
export function SubscriptionGate({ children }: SubscriptionGateProps) {
  const user = useUser();
  const router = useRouter();
  const pathname = usePathname();
  const devStatus = getDevSubscriptionStatus();
  const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL || '/';

  const teaserRoutes = ['/dashboard', '/performance', '/performance/overview', '/performance/live', '/performance/journal', '/account', '/tradesignals'];
  const dynamicRoutes = ['/tradesignals/']; // Matches /tradesignals/[id]
  const isTeaserRoute = teaserRoutes.includes(pathname ?? '') ||
    dynamicRoutes.some(route => pathname?.startsWith(route));
  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    if (typeof window !== 'undefined') {
      window.location.href = marketingUrl;
    } else {
      router.push('/');
      router.refresh();
    }
  };

  // In dev override mode we always allow access
  if (devStatus) {
    return <>{children}</>;
  }

  const isPro = user?.subscription_tier === "pro";

  // Always show teaser routes regardless of tier
  if (isPro || isTeaserRoute) {
    return <>{children}</>;
  }

  return (
    <div className="relative min-h-screen">
      {/* Underlying app is visible but not interactive */}
      <div className="opacity-40 pointer-events-none select-none">
        {children}
      </div>

      {/* Blocking paywall overlay limited to content area */}
      <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80">
        <div className="w-full max-w-md rounded-xl bg-white border border-gray-200 shadow-xl p-6 text-center">
          <Lock className="h-10 w-10 text-gray-700 mx-auto mb-3" />

          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            Unlock full dashboard access
          </h2>

          <p className="text-sm text-gray-600 mb-3">
            Subscribe to Marild Pro to access the live model portfolio, AI market
            summaries, sector strength, and TradeSignals.
          </p>

          <ul className="text-xs text-gray-500 text-left mb-4 space-y-1">
            <li>• AI Market Summary & correction risk dashboard</li>
            <li>• Sector strength & rotation insights</li>
            <li>• Performance preview of recent TradeSignals</li>
          </ul>

          <UpgradeButton className="w-full bg-[#0AAE84] hover:bg-[#0AAE84]/90 text-white mb-2" />
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs text-gray-500"
            onClick={handleLogout}
          >
            Log out
          </Button>
        </div>
      </div>
    </div>
  );
}
