"use client";

export function AITradePlansSection() {
  return (
    <section className="border-t border-neutral-900/40 bg-black/40">
      <div className="container mx-auto px-4 py-16 lg:py-20">
        <div className="max-w-5xl mx-auto space-y-8">
          <div className="space-y-3 text-center">
            <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight">
              Not Just Signals. AI Trade Plans.
            </h2>
            <p className="text-lg sm:text-xl text-muted-foreground">
              Every signal includes a complete, transparent trading framework.
            </p>
          </div>

          <div className="max-w-3xl mx-auto text-base sm:text-lg text-muted-foreground text-center space-y-2">
            <p>
              Marild signals are not vague buy or sell alerts. Each signal comes with a clearly defined
              AI trade plan — including entry levels, stop-loss logic, primary profit targets, and the
              same predefined rules used by our AI model portfolio.
            </p>
          </div>

          {/* Conceptual visual only – no live P&L or real UI */}
          <div className="mt-6 flex justify-center">
            <div className="inline-flex flex-col items-stretch gap-4 rounded-2xl border border-neutral-800/80 bg-neutral-950/80 max-w-4xl w-full px-8 py-7 text-sm sm:text-base text-muted-foreground">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-100 text-base sm:text-lg">AI Trade Plan</span>
                <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs sm:text-sm text-emerald-300">
                  Plan → Execution → Outcome
                </span>
              </div>

              <div className="mt-2 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs sm:text-sm uppercase tracking-wide text-zinc-400">Entry</span>
                  <span className="h-px flex-1 mx-4 bg-gradient-to-r from-emerald-500/60 via-emerald-400/60 to-emerald-500/60" />
                  <span className="text-xs sm:text-sm uppercase tracking-wide text-zinc-400">Target</span>
                </div>
                <div className="flex items-center justify-between text-xs sm:text-sm text-zinc-500">
                  <span>Defined entry</span>
                  <span>Primary target (TP1)</span>
                </div>

                <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs sm:text-sm">
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-4 space-y-1">
                    <p className="font-medium text-zinc-100">Clarity</p>
                    <p className="text-zinc-400">
                      You see exactly how each trade is meant to be managed.
                    </p>
                  </div>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-4 space-y-1">
                    <p className="font-medium text-zinc-100">Consistency</p>
                    <p className="text-zinc-400">
                      The same execution logic is applied across AI-traded positions.
                    </p>
                  </div>
                  <div className="rounded-lg border border-neutral-800 bg-neutral-950/80 p-4 space-y-1">
                    <p className="font-medium text-zinc-100">Transparency</p>
                    <p className="text-zinc-400">
                      Benchmark your execution against the AI model portfolio.
                    </p>
                  </div>
                </div>
              </div>

              <p className="mt-4 text-xs sm:text-sm text-zinc-500">
                Signals represent AI-generated trade plans. Results assume adherence to the predefined trade plan.
                Manual execution may vary.
              </p>

              <div className="mt-2 flex justify-center">
                <a
                  href="#landing-faq"
                  className="text-xs sm:text-sm text-emerald-300 hover:text-emerald-200 underline-offset-2 hover:underline"
                >
                  Learn how our AI trade plans work
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
