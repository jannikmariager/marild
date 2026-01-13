const pricingFaqs = [
  {
    question: "Why don’t you offer a free trial?",
    answer:
      "Signals come from a live, capacity-limited portfolio. We avoid free trials to keep abuse out of the feed and to ensure every subscriber sees the same fills and executions. Instead of a trial, the public landing site mirrors the real equity curve so you can evaluate actual performance before subscribing.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. Plans renew monthly and you can cancel from the billing portal with no lock-in. Access remains active until the end of the paid period.",
  },
  {
    question: "Do you offer refunds?",
    answer:
      "Because signals are delivered immediately, fees are non-refundable except where consumer laws require it. We recommend reviewing the live equity curve and documentation before upgrading.",
  },
  {
    question: "Is there a cheaper or annual plan?",
    answer:
      "Marild intentionally keeps a single $69/month plan. It funds the data, infra, and risk monitoring needed for the live model portfolio. We revisit pricing annually as costs change, but there are no hidden tiers or upsells.",
  },
  {
    question: "Can I expense this for my team?",
    answer:
      "Yes. After checkout you receive invoices with VAT/Tax ID fields. For teams needing consolidated billing, contact support@marild.com and we can provision a single account with multiple seats.",
  },
];

export function PricingFaqSection() {
  return (
    <section className="py-16 md:py-24 border-t border-border/20">
      <div className="max-w-5xl mx-auto px-4 space-y-10">
        <div className="text-center space-y-4">
          <p className="text-sm uppercase tracking-[0.4em] text-emerald-400">Pricing questions</p>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">Straight answers before you subscribe</h2>
          <p className="text-base md:text-lg text-muted-foreground">
            We treat the subscription like access to a trading desk—no vague promises, just the facts.
          </p>
        </div>
        <div className="space-y-4">
          {pricingFaqs.map((item) => (
            <div key={item.question} className="rounded-2xl border border-border/40 bg-card/80 shadow-lg shadow-emerald-500/5 backdrop-blur px-6 py-6">
              <h3 className="text-lg font-semibold mb-2 text-foreground">{item.question}</h3>
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed">{item.answer}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
