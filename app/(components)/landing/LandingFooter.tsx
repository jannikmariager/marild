"use client";

import Link from "next/link";
import { MessageCircle, Send, Twitter, Instagram } from "lucide-react";
import { Separator } from "@/components/ui/separator";

const footerLinks = {
  product: [
    { label: "Pricing", href: "/pricing" },
    { label: "Dashboard", href: "/dashboard" },
    { label: "Performance", href: "/performance" },
    { label: "Signals", href: "/signals" },
  ],
  legal: [
    { label: "Terms of Service", href: "/terms" },
    { label: "Privacy Policy", href: "/privacy" },
    { label: "Data Policy", href: "/data-policy" },
    { label: "EULA", href: "/eula" },
  ],
  social: [
    { label: "Discord", icon: MessageCircle, href: "https://discord.gg/tradelens" },
    { label: "Telegram", icon: Send, href: "https://t.me/tradelens" },
    { label: "Twitter", icon: Twitter, href: "https://twitter.com/tradelens" },
    { label: "Instagram", icon: Instagram, href: "https://instagram.com/tradelens" },
  ],
};

export function LandingFooter() {
  return (
    <footer className="border-t border-border/50 bg-background/50 backdrop-blur-sm">
      <div className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-4 gap-12 mb-12">
          {/* Logo and tagline */}
          <div className="md:col-span-2">
            <Link href="/" className="inline-block mb-4">
              <div className="text-2xl font-bold bg-gradient-to-r from-emerald-500 to-emerald-300 bg-clip-text text-transparent">
Marild
              </div>
            </Link>
            <p className="text-muted-foreground leading-relaxed max-w-md">
              Structured AI market intelligence for modern traders. Real signals, full transparency, zero hype.
            </p>
            <p className="text-sm text-muted-foreground mt-3">
              Reach us anytime at{" "}
              <a href="mailto:support@marild.com" className="text-foreground underline-offset-2 hover:underline">
                support@marild.com
              </a>
              .
            </p>
          </div>
          
          {/* Product links */}
          <div>
            <h3 className="font-semibold mb-4">Product</h3>
            <ul className="space-y-3">
              {footerLinks.product.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground transition-colors text-sm"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          
          {/* Legal links */}
          <div>
            <h3 className="font-semibold mb-4">Legal</h3>
            <ul className="space-y-3">
              {footerLinks.legal.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-muted-foreground hover:text-foreground transition-colors text-sm"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        
        <Separator className="mb-8" />
        
        {/* Bottom row */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
          <p className="text-sm text-muted-foreground">
© 2025 Marild. All rights reserved. Nothing on this site constitutes financial advice.
          </p>
          
          {/* Social icons */}
          <div className="flex items-center gap-4">
            {footerLinks.social.map((social) => {
              const Icon = social.icon;
              return (
                <Link
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={social.label}
                >
                  <Icon className="w-5 h-5" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </footer>
  );
}
