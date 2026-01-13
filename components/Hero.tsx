import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AppStoreButtons } from '@/components/AppStoreButtons'
import { ArrowRight } from 'lucide-react'

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-background" />
        <div className="absolute top-1/4 left-1/4 h-96 w-96 rounded-full bg-primary/30 blur-3xl animate-glow" />
        <div className="absolute bottom-1/4 right-1/4 h-96 w-96 rounded-full bg-blue-500/20 blur-3xl animate-glow" style={{ animationDelay: '2s' }} />
      </div>

      <div className="container py-24 md:py-32 lg:py-40">
        <div className="mx-auto flex max-w-4xl flex-col items-center gap-8 text-center">
          <div className="space-y-4">
            <h1 className="text-4xl font-bold tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
              AI-Driven Market Intelligence.{' '}
              <span className="bg-gradient-to-r from-primary to-blue-500 bg-clip-text text-transparent">
                Delivered.
              </span>
            </h1>
            <p className="mx-auto max-w-2xl text-lg text-muted-foreground sm:text-xl">
Signals, Sentiment, Smart Money Concepts & Real-Time Market Analysis—powered by Marild.
            </p>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            <Button size="lg" asChild>
              <Link href="/signup">
                Get Started
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/login">Login</Link>
            </Button>
          </div>

          <div className="mt-8">
            <AppStoreButtons />
          </div>
        </div>
      </div>
    </section>
  )
}
