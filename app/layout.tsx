import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from 'sonner';
import { DashboardTransitionProvider } from "@/components/DashboardTransitionProvider";
import "./globals.css";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <DashboardTransitionProvider>
          {children}
          <Toaster position="top-right" richColors />
        </DashboardTransitionProvider>
      </body>
    </html>
  )
}
