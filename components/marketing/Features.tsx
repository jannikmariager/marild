import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  TrendingUp, 
  Brain, 
  Gauge, 
  Newspaper, 
  BarChart3, 
  Smartphone 
} from 'lucide-react'

export function Features() {
  const features = [
    {
      title: 'AI Signals',
      description: 'Advanced machine learning algorithms analyze market patterns to deliver high-probability trading signals in real-time.',
      icon: Brain,
    },
    {
      title: 'Smart Money Concepts',
      description: 'Track institutional order flow and identify smart money movements before they impact the market.',
      icon: TrendingUp,
    },
    {
      title: 'Risk Gauge',
      description: 'Comprehensive sentiment analysis combined with macroeconomic indicators to assess market risk levels.',
      icon: Gauge,
    },
    {
      title: 'Automated News Scanning',
      description: 'Real-time news aggregation and analysis to keep you informed of market-moving events as they happen.',
      icon: Newspaper,
    },
    {
      title: 'Volume & Technical Indicators',
      description: 'Advanced charting tools with custom indicators for volume analysis and technical pattern recognition.',
      icon: BarChart3,
    },
    {
      title: 'Multi-Platform Access',
      description: 'Seamless experience across mobile app, web dashboard, and Discord bot for trading on the go.',
      icon: Smartphone,
    },
  ]

  return (
    <section className="container py-24 md:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
            Why Traders Use TradeLens
          </h2>
          <p className="mx-auto max-w-2xl text-lg text-muted-foreground">
            Professional-grade tools and insights powered by AI to give you an edge in the markets.
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon
            return (
              <Card key={feature.title} className="border-border/50">
                <CardHeader>
                  <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <CardTitle>{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-base">
                    {feature.description}
                  </CardDescription>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </section>
  )
}
