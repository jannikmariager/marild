import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: true,
  },
  alternates: {
    canonical: "https://marild.com/terms",
  },
};

export default function TermsPage() {
  return (
    <div className="container mx-auto py-12 px-4 sm:px-6 lg:px-8 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8 text-foreground">Terms of Service</h1>
      <p className="text-sm text-muted-foreground mb-8">Last Updated: December 2, 2025</p>

      <div className="space-y-8 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">1. Acceptance of Terms</h2>
          <p>
            By accessing or using TradeLens (&quot;Service&quot;, &quot;Platform&quot;, &quot;we&quot;, &quot;us&quot;, or &quot;our&quot;), you agree to be bound by these Terms of Service. 
            If you do not agree to these terms, do not use the Service.
          </p>
        </section>

        <section className="border-l-4 border-destructive pl-6 bg-destructive/5 py-4">
          <h2 className="text-2xl font-semibold mb-4 text-destructive">2. NOT FINANCIAL ADVICE - CRITICAL DISCLAIMER</h2>
          <div className="space-y-3 font-semibold">
            <p>
              THE INFORMATION, SIGNALS, ANALYSIS, AND CONTENT PROVIDED BY TRADELENS ARE FOR INFORMATIONAL AND EDUCATIONAL PURPOSES ONLY. 
              NOTHING ON THIS PLATFORM CONSTITUTES FINANCIAL ADVICE, INVESTMENT ADVICE, TRADING ADVICE, OR ANY OTHER TYPE OF ADVICE.
            </p>
            <p>
              YOU ALONE ARE SOLELY RESPONSIBLE FOR DETERMINING WHETHER ANY INVESTMENT, SECURITY, STRATEGY, OR RELATED TRANSACTION IS 
              APPROPRIATE FOR YOU BASED ON YOUR PERSONAL INVESTMENT OBJECTIVES, FINANCIAL CIRCUMSTANCES, AND RISK TOLERANCE.
            </p>
            <p>
              YOU SHOULD CONSULT WITH LICENSED FINANCIAL ADVISORS, TAX PROFESSIONALS, AND/OR LEGAL COUNSEL BEFORE MAKING ANY FINANCIAL 
              DECISIONS OR INVESTMENTS.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">3. Risk Disclosure</h2>
          <div className="space-y-3">
            <p className="font-semibold">Trading and investing in financial markets involves substantial risk of loss and is not suitable for every investor.</p>
            <p>You acknowledge and agree that:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Past performance is not indicative of future results</li>
              <li>Trading signals and analysis may be inaccurate, incomplete, or outdated</li>
              <li>You may lose some or all of your invested capital</li>
              <li>Market conditions can change rapidly and unpredictably</li>
              <li>AI and algorithmic analysis can produce errors and false signals</li>
              <li>No guarantee of profit or protection from loss is provided</li>
            </ul>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">4. No Warranties</h2>
          <p>
            THE SERVICE IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, 
            INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.
          </p>
          <p className="mt-3">
            We do not warrant that the Service will be uninterrupted, error-free, secure, or free from viruses or other harmful components. 
            We do not warrant the accuracy, completeness, or reliability of any content, signals, or analysis.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">5. Limitation of Liability</h2>
          <div className="space-y-3">
            <p className="font-semibold">
              TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, TRADELENS, ITS OFFICERS, DIRECTORS, EMPLOYEES, AGENTS, AND AFFILIATES 
              SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING BUT NOT LIMITED TO:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Loss of profits, revenue, or data</li>
              <li>Trading losses or investment losses</li>
              <li>Business interruption</li>
              <li>Loss of business opportunities</li>
              <li>Any other commercial damages or losses</li>
            </ul>
            <p className="mt-3 font-semibold">
              IN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU FOR ALL DAMAGES, LOSSES, AND CAUSES OF ACTION EXCEED THE AMOUNT YOU PAID 
              TO US IN THE TWELVE (12) MONTHS PRIOR TO THE CLAIM.
            </p>
          </div>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">6. User Responsibilities</h2>
          <p>You agree to:</p>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>Use the Service at your own risk</li>
            <li>Conduct your own research and due diligence</li>
            <li>Not rely solely on our signals or analysis for investment decisions</li>
            <li>Comply with all applicable laws and regulations</li>
            <li>Maintain the confidentiality of your account credentials</li>
            <li>Not attempt to manipulate, reverse engineer, or misuse the Service</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">7. Indemnification</h2>
          <p>
            You agree to indemnify, defend, and hold harmless TradeLens and its officers, directors, employees, agents, and affiliates 
            from and against any claims, liabilities, damages, losses, costs, expenses, or fees (including reasonable attorneys&apos; fees) 
            arising from your use of the Service, your violation of these Terms, or your violation of any rights of a third party.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">8. Subscription and Payment</h2>
          <ul className="list-disc pl-6 space-y-2">
            <li>Subscription fees are non-refundable except as required by law</li>
            <li>You authorize us to charge your payment method on a recurring basis</li>
            <li>We may change pricing with 30 days notice</li>
            <li>You may cancel your subscription at any time</li>
            <li>Access continues until the end of the current billing period after cancellation</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">9. Termination</h2>
          <p>
            We reserve the right to suspend or terminate your access to the Service at any time, with or without cause, with or without notice. 
            Upon termination, all provisions of these Terms which by their nature should survive shall survive, including but not limited to 
            disclaimers, limitations of liability, and indemnification provisions.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">10. Governing Law and Dispute Resolution</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of Denmark, without regard to its conflict of law provisions. 
            Any disputes arising from these Terms or your use of the Service shall be resolved through binding arbitration, except where prohibited by law.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">11. Changes to Terms</h2>
          <p>
            We reserve the right to modify these Terms at any time. Changes will be effective immediately upon posting. 
            Your continued use of the Service after changes constitutes acceptance of the modified Terms.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">12. Contact</h2>
          <p>
            For questions about these Terms, contact us at: <a href="mailto:hello@alexma.app" className="text-primary hover:underline">hello@alexma.app</a>
          </p>
        </section>

        <section className="border-t pt-6 mt-8">
          <p className="font-semibold text-center">
            BY USING TRADELENS, YOU ACKNOWLEDGE THAT YOU HAVE READ, UNDERSTOOD, AND AGREE TO BE BOUND BY THESE TERMS OF SERVICE.
          </p>
        </section>
      </div>
    </div>
  )
}
