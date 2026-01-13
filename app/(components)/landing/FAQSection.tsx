"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle, BadgeCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface FaqItem {
  id: string;
  question: string;
  badge?: React.ReactNode;
  content: React.ReactNode;
}

const faqItems: FaqItem[] = [
  {
    id: "faq-1",
    question: "What is Marild?",
    content: (
      <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
        Marild is a signal intelligence platform that identifies high-confidence market opportunities using structure, volatility, and momentum. Unlike traditional systems that force trades into artificial timeframes, Marild adapts to market conditions—surfacing signals only when conditions align. Every signal is tracked transparently through a live model portfolio.
      </p>
    ),
  },
  {
    id: "faq-2",
    question: "How are your results calculated?",
    badge: (
      <Badge
        variant="outline"
        className="ml-2 border-emerald-500/40 bg-emerald-500/5 text-[0.65rem] uppercase tracking-wide text-emerald-700 dark:text-emerald-300"
      >
        Verified model portfolio
      </Badge>
    ),
    content: (
      <div className="space-y-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
        <p>
          Results are calculated using a standardized <span className="font-medium">$100,000 model portfolio</span>. Every signal uses consistent risk parameters, realistic position sizing, and the same rules across all opportunities.
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Same starting equity and risk parameters for every portfolio.</li>
          <li>Position sizes are constrained by available capital and risk per trade.</li>
          <li>No hindsight optimization or retroactive changes to signals.</li>
          <li>The same execution rules apply to every ticker in the universe.</li>
        </ul>
      </div>
    ),
  },
  {
    id: "faq-3",
    question: "What does Expectancy (R) mean?",
    content: (
      <div className="space-y-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
        <p>
          Expectancy measures how much a strategy makes or loses on average per unit of risk, expressed in
          <span className="font-medium"> R</span>. A positive expectancy means that, over a large sample of
          trades, the strategy is profitable after accounting for both wins and losses.
        </p>
        <p>
          Because expectancy is calculated in risk units rather than raw dollars or win rate alone, it is
          harder to manipulate and provides a clearer view of long-term edge.
        </p>
        <p className="rounded-md bg-muted px-4 py-3 text-xs sm:text-sm">
          Example: if a strategy risks $1,000 per trade and, over many trades, averages +$200 per trade, its
          expectancy is <span className="font-semibold">+0.2R</span>. Individual trades will vary, but the
          average effect of the system is positive.
        </p>
      </div>
    ),
  },
  {
    id: "faq-4",
    question: "Why don’t you show Sharpe ratio?",
    content: (
      <div className="space-y-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
        <p>
          Sharpe ratio is designed for continuous return streams. For opportunity-driven signal systems where positions resolve on their own timeline, it can be noisy and misleading.
        </p>
        <p>
          Instead, Marild focuses on metrics that better reflect how signals actually perform:
          <span className="font-medium"> Success Rate, Drawdown, and Expectancy</span>. Together these
          describe how the system behaves over time and whether it has a positive edge.
        </p>
      </div>
    ),
  },
  {
    id: "faq-5",
    question: "How does the AI decide when to trade?",
    content: (
      <div className="space-y-4 text-sm sm:text-base text-muted-foreground leading-relaxed">
        <p>
          Marild evaluates market opportunities using a multi-layered approach before any trade enters the model portfolio:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li><span className="font-medium">Signal Generation:</span> AI scans 50+ approved tickers every hour during market hours, analyzing Smart Money Concepts, volume confirmation, and sentiment data.</li>
          <li><span className="font-medium">Confidence Scoring:</span> Only signals above 60% confidence with strong confluence are considered for entry.</li>
          <li><span className="font-medium">Risk Validation:</span> Position sizing uses 0.75% risk per trade with strict limits (max 80% allocated, max 10 concurrent positions).</li>
          <li><span className="font-medium">Entry Execution:</span> Portfolio manager evaluates signals every 5 minutes and enters when capital and risk limits allow.</li>
          <li><span className="font-medium">Exit Management:</span> Positions monitored every minute for take-profit hits, stop-loss triggers, or trailing stop activation (starts after 1.5R profit).</li>
        </ul>
        <p className="text-xs italic mt-2">
          No trade is forced—signals only execute when market structure, risk parameters, and portfolio constraints all align.
        </p>
      </div>
    ),
  },
  {
    id: "faq-6",
    question: "Are signals generated in real time?",
    content: (
      <div className="space-y-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
        <p>
          Signals are generated <span className="font-medium">hourly</span> during market hours (every hour at :30 past the hour from 9:30 AM - 4:30 PM ET). Each scan evaluates all 50+ approved tickers and updates signals in real-time.
        </p>
        <p>
          <span className="font-medium">Execution is continuous:</span> The portfolio manager runs every 5 minutes to evaluate new signals and enter positions. Open positions are monitored every minute for price updates and exit conditions. Performance statistics update live as trades close.
        </p>
        <p className="text-xs italic">
          This separation allows the AI to generate thoughtful signals without rushing, while execution responds quickly to market conditions.
        </p>
      </div>
    ),
  },
  {
    id: "faq-7",
    question: "Do you trade these signals yourself?",
    content: (
      <div className="space-y-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
        <p>
          Marild is evaluated through a <span className="font-medium">live model portfolio</span> executing real signals with $100,000 in capital. This avoids cherry-picking and survivorship bias—the same rules apply to every signal, regardless of whether any individual trader chooses to take a particular trade.
        </p>
        <p>
          By separating the model portfolio from personal execution, the platform reports what the system actually did, not what any single trader happened to do.
        </p>
      </div>
    ),
  },
  {
    id: "faq-8",
    question: "Is this financial advice?",
    content: (
      <div className="space-y-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
        <p>
          No. Marild provides educational and informational tools only. Nothing on the platform should be interpreted as personalized investment, trading, or financial advice.
        </p>
        <p>
          Trading involves risk, including the risk of loss. Past performance does not guarantee future results, and you should carefully evaluate whether trading is appropriate for your financial situation.
        </p>
      </div>
    ),
  },
  {
    id: "faq-9",
    question: "Why do some tickers disappear?",
    content: (
      <div className="space-y-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
        <p>
          Tickers are continuously evaluated based on current market regime and signal quality. When
          conditions deteriorate for a symbol—for example, prolonged low liquidity or structurally poor price
          action—that ticker may be temporarily removed from active coverage.
        </p>
        <p>
          This allows the system to focus on instruments where the logic is currently performing best, rather
          than forcing coverage for the sake of quantity.
        </p>
      </div>
    ),
  },
  {
    id: "faq-10",
    question: "Who is Marild for?",
    content: (
      <div className="space-y-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
        <p>
          Marild is built for those who treat markets as a discipline rather than entertainment. Typical users are serious, risk-aware, and data-driven—valuing transparency over hype.
        </p>
        <p className="font-medium text-foreground">
          If you want high-confidence signals without guesswork, Marild is for you.
        </p>
      </div>
    ),
  },
];

export function FAQSection() {
  const [openId, setOpenId] = useState<string | null>("faq-1");

  return (
    <section id="landing-faq" className="py-24">
      <div className="container mx-auto px-4 max-w-4xl">
        <div className="text-center mb-10 sm:mb-12">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 mb-3">
            <BadgeCheck className="h-4 w-4 text-emerald-500" />
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
              Built for transparency
            </span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3">
            Frequently Asked Questions
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground max-w-2xl mx-auto">
            Everything you need to know about how Marild works, how we trade, and how performance is tracked.
          </p>
        </div>

        <div className="space-y-4">
          {faqItems.map((item) => {
            const isOpen = openId === item.id;

            return (
              <Card
                key={item.id}
                className={cn(
                  "group overflow-hidden border-2 border-white/10 bg-white/5 shadow-sm transition-all", // base
                  isOpen ? "border-emerald-500/40 bg-white/[0.08] shadow-lg shadow-emerald-500/10" : "hover:border-white/20 hover:bg-white/[0.07] hover:shadow-md"
                )}
              >
                <button
                  type="button"
                  onClick={() => setOpenId(isOpen ? null : item.id)}
                  className="flex w-full items-center justify-between gap-3 px-4 sm:px-6 py-4 sm:py-5 text-left"
                  aria-expanded={isOpen}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-1 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500 group-hover:bg-emerald-500/15 transition-colors">
                      <HelpCircle className="h-4 w-4" />
                    </div>
                    <div className="text-sm sm:text-base font-medium flex flex-wrap items-center">
                      <span>{item.question}</span>
                      {item.badge}
                    </div>
                  </div>
                  <ChevronDown
                    className={cn(
                      "h-5 w-5 text-muted-foreground transition-transform duration-200",
                      isOpen && "rotate-180"
                    )}
                  />
                </button>
                <div
                  className={cn(
                    "grid px-4 sm:px-6 pb-4 sm:pb-5 text-sm transition-all duration-300 ease-out",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                  )}
                >
                  <div className="overflow-hidden">
                    {item.content}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
