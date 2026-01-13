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
    <div className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <DashboardTransitionProvider>
        <Navbar />
        <main>{children}</main>
        <Footer />
        <Analytics />
      </DashboardTransitionProvider>
    </div>
  );
}
