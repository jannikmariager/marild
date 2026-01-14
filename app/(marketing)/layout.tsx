import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "@/app/globals.css";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { DashboardTransitionProvider } from "@/components/DashboardTransitionProvider";
import { Analytics } from "@/components/Analytics";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
title: "Marild - AI-Driven Market Intelligence",
  description: "Signals, Sentiment, Smart Money Concepts & Real-Time Market Analysis powered by AI. Professional trading tools for modern traders.",
};

export default function MarketingLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      className={`marketing-theme ${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <DashboardTransitionProvider>
        <div className="relative min-h-screen bg-background text-foreground">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(16,185,129,0.12),_transparent_45%),_radial-gradient(circle_at_bottom,_rgba(59,130,246,0.15),_transparent_55%)] opacity-80" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(59,130,246,0.08),transparent,rgba(16,185,129,0.08))]" />
          <div className="relative z-10 flex min-h-screen flex-col">
            <Navbar />
            <main className="flex-1">{children}</main>
            <Footer />
          </div>
          <Analytics />
        </div>
      </DashboardTransitionProvider>
    </div>
  );
}
