export default function PrivacyPage() {
  return (
    <div className="container mx-auto py-12 px-4 sm:px-6 lg:px-8 max-w-4xl">
      <h1 className="text-4xl font-bold mb-8 text-foreground">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">Last Updated: December 2, 2025</p>

      <div className="space-y-8 text-sm leading-relaxed text-foreground">
        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">1. Introduction</h2>
          <p>
            This Privacy Policy explains how TradeLens (&quot;we&quot;, &quot;us&quot;, &quot;our&quot;) collects, uses, and protects your personal data when you use our 
            website, applications, and services (collectively, the &quot;Service&quot;).
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">2. Data We Collect</h2>
          <p>We may collect the following categories of information:</p>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>
              <span className="font-semibold">Account Information:</span> Email address, password (hashed), and basic profile details.
            </li>
            <li>
              <span className="font-semibold">Usage Data:</span> Pages visited, features used, timestamps, device information, approximate location.
            </li>
            <li>
              <span className="font-semibold">Subscription &amp; Billing Data:</span> Plan type, subscription status, and billing metadata (actual 
              payment details are processed by Stripe and not stored by us).
            </li>
            <li>
              <span className="font-semibold">Trading Preferences:</span> Watchlists, preferred markets, and settings you configure in the platform.
            </li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">3. How We Use Your Data</h2>
          <p>We use your data to:</p>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>Provide, operate, and maintain the Service</li>
            <li>Authenticate users and secure accounts</li>
            <li>Deliver personalized dashboards, alerts, and signals</li>
            <li>Improve and optimize the performance of our algorithms and platform</li>
            <li>Communicate with you about updates, security notices, and support</li>
            <li>Comply with legal obligations and enforce our Terms of Service</li>
          </ul>
        </section>

        <section className="border-l-4 border-destructive pl-6 bg-destructive/5 py-4">
          <h2 className="text-2xl font-semibold mb-4 text-destructive">4. No Sharing of Trading Decisions</h2>
          <p>
            We do not use, resell, or share your individual trading decisions, positions, or custom strategies with third parties for their 
            own marketing or trading purposes. Any analytics performed on user behavior is aggregated and anonymized.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">5. Legal Basis (EU/EEA Users)</h2>
          <p>For users in the EU/EEA, we process personal data under the following legal bases:</p>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>Performance of a contract (providing the Service)</li>
            <li>Legitimate interests (improving the Service, preventing abuse)</li>
            <li>Compliance with legal obligations</li>
            <li>Consent (where required, e.g., marketing communications)</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">6. Data Retention</h2>
          <p>
            We retain your data for as long as your account is active, and as necessary to comply with legal obligations, resolve disputes, and 
            enforce our agreements. When your account is closed, we may retain limited data as required by law or for legitimate business interests.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">7. Data Security</h2>
          <p>
            We implement reasonable technical and organizational measures to protect your data, including encrypted connections (HTTPS), secure 
            storage, and access controls. However, no method of transmission or storage is completely secure, and we cannot guarantee absolute security.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">8. Third-Party Services</h2>
          <p>
            We use third-party providers to operate parts of the Service, including but not limited to:
          </p>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>Supabase (authentication, database, storage)</li>
            <li>Stripe (payments and billing)</li>
            <li>Analytics and error monitoring providers</li>
          </ul>
          <p className="mt-3">
            These providers process data on our behalf and are bound by contractual obligations to protect your information.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">9. International Transfers</h2>
          <p>
            Your data may be processed and stored in countries outside your country of residence. Where required, we use appropriate safeguards 
            such as standard contractual clauses to protect your data.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">10. Your Rights</h2>
          <p>Depending on your jurisdiction, you may have the right to:</p>
          <ul className="list-disc pl-6 space-y-2 mt-3">
            <li>Access the personal data we hold about you</li>
            <li>Request correction of inaccurate or incomplete data</li>
            <li>Request deletion of your data (subject to legal obligations)</li>
            <li>Object to or restrict certain processing</li>
            <li>Data portability</li>
            <li>Withdraw consent where processing is based on consent</li>
          </ul>
          <p className="mt-3">
            To exercise these rights, contact us at: <a href="mailto:hello@alexma.app" className="text-primary hover:underline">hello@alexma.app</a>
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">11. Children&apos;s Privacy</h2>
          <p>
            The Service is not intended for individuals under 18 years of age. We do not knowingly collect personal data from children under 18. 
            If you believe a child has provided us with personal data, contact us and we will take steps to delete such information.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">12. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated &quot;Last Updated&quot; date. 
            Your continued use of the Service after changes indicates your acceptance of the updated policy.
          </p>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-4 text-foreground">13. Contact</h2>
          <p>
            If you have questions about this Privacy Policy or our data practices, contact us at: 
            <a href="mailto:hello@alexma.app" className="text-primary hover:underline"> hello@alexma.app</a>
          </p>
        </section>
      </div>
    </div>
  )
}
