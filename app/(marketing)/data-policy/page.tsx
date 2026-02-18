import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
  },
  alternates: {
    canonical: "https://marild.com/data-signals-policy",
  },
};

export default function DataPolicyPage() {
  return (
    <div className="container mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-4xl font-bold mb-8">Data &amp; Signals Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">Last Updated: December 2, 2025</p>

      <div className="space-y-8 text-sm leading-relaxed">
        <section>
          <h2 className="text-2xl font-semibold mb-4">1. Purpose of This Policy</h2>
          <p>
            This Data &amp; Signals Policy explains how TradeLens generates, processes, and presents market data, analytics, and trading signals. 
            It is intended to clarify how our AI and algorithmic systems operate and to explicitly limit our liability for the use of such data.
          </p>
        </section>

        <section className="border-l-4 border-destructive pl-6 bg-destructive/5 py-4">
          <h2 className="text-2xl font-semibold mb-4 text-destructive">2. Signals Are Informational Only</h2>
          <div className="space-y-3 font-semibold">
            <p>
              ALL SIGNALS, ALERTS, INDICATORS, SCORES, AND ANALYTICS PROVIDED BY TRADELENS ARE FOR INFORMATIONAL AND EDUCATIONAL PURPOSES ONLY.
            </p>
            <p>
              THEY DO NOT CONSTITUTE FINANCIAL ADVICE, INVESTMENT ADVICE, OR ANY RECOMMENDATION TO BUY, SELL, OR HOLD ANY ASSET.
            </p>
            <p>
              YOU ALONE ARE 100% RESPONSIBLE FOR ANY TRADING OR INVESTMENT DECISIONS YOU MAKE BASED ON INFORMATION FROM THE PLATFORM.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">3. How Signals Are Generated</h2>
          <p>
            Our signals and analytics are generated using a combination of:
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>Algorithmic and AI-driven models</li>
            <li>Historical price and volume data</li>
            <li>Market structure and technical indicators</li>
            <li>News and sentiment analysis (where applicable)</li>
            <li>Risk and volatility models</li>
          </ul>
          <p className="mt-3">
            These models are probabilistic and may produce incorrect, delayed, or misleading outputs. No model is perfect, and all outputs 
            should be considered as one input among many in your own decision-making process.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">4. No Guarantee of Accuracy</h2>
          <p>
            While we make reasonable efforts to maintain data quality, we do not guarantee that any data, signal, or analysis is accurate, 
            complete, up-to-date, or free from errors. Data sources may fail, be delayed, or provide incorrect information.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">5. User Responsibility</h2>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>You are solely responsible for verifying any data or signal before acting on it</li>
            <li>You agree not to rely solely on TradeLens for any financial decision</li>
            <li>You acknowledge that all trading and investing involves risk of loss</li>
            <li>You agree to conduct your own independent research and due diligence</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">6. Aggregated &amp; Anonymized Data</h2>
          <p>
            We may aggregate and anonymize usage data and high-level trading behavior (e.g., which assets are being viewed or followed) to 
            improve our models and the Service. We do not sell personally identifiable trading data to third parties.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">7. Third-Party Data Sources</h2>
          <p>
            Some data presented in the platform may originate from third-party providers. We do not control these sources and are not 
            responsible for their accuracy or availability. Third-party terms may apply to certain data streams.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">8. Limitation of Liability for Data and Signals</h2>
          <p className="font-semibold">
            TO THE MAXIMUM EXTENT PERMITTED BY LAW, TRADELENS SHALL NOT BE LIABLE FOR ANY LOSSES OR DAMAGES ARISING FROM:
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>Your reliance on any data, signal, or analysis provided by the Service</li>
            <li>Any errors, delays, or interruptions in data delivery</li>
            <li>Any trading or investment decisions you make</li>
            <li>Loss of profits, capital, or opportunities</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">9. Regulatory Status</h2>
          <p>
            TradeLens is not a broker-dealer, investment advisor, or financial institution. We do not execute trades on your behalf, 
            and we do not provide personalized investment recommendations.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">10. Changes to This Policy</h2>
          <p>
            We may update this Data &amp; Signals Policy from time to time. Changes will be posted on this page with an updated &quot;Last Updated&quot; date. 
            Your continued use of the Service after changes indicates your acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4">11. Contact</h2>
          <p>
            For questions about this policy, contact us at: <a href="mailto:hello@alexma.app" className="text-primary hover:underline">hello@alexma.app</a>
          </p>
        </section>

        <section className="border-t pt-6 mt-8">
          <p className="font-semibold text-center">
            BY USING TRADELENS, YOU ACKNOWLEDGE AND AGREE THAT ALL USE OF DATA, ANALYTICS, AND SIGNALS IS ENTIRELY AT YOUR OWN RISK.
          </p>
        </section>
      </div>
    </div>
  )
}
