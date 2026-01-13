'use client';

import { Topbar } from '@/components/layout/topbar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { Target, Clock, Cpu, BarChart3, Shield, CheckCircle, ArrowUpCircle, Timer, Scale } from 'lucide-react';

export default function HowItWorksPage() {
  return (
    <div>
      <Topbar title="How It Works" />
      <div className="p-6 space-y-6 max-w-5xl mx-auto">
        {/* Hero Section */}
        <div className="text-center space-y-4 py-8">
          <h1 className="text-4xl font-bold">How TradeLens AI Works</h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto">
            Transparent insights into our AI-driven trading system. Learn what we trade, when we
            trade, and how we continuously improve signal quality.
          </p>
        </div>

        {/* What We Trade */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Target className="h-6 w-6 text-emerald-600" />
              <CardTitle>What We Trade</CardTitle>
            </div>
            <CardDescription>
              Focus on high-quality opportunities for better risk-adjusted returns
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Dynamic Ticker Universe</h3>
              <p className="text-sm text-muted-foreground mb-3">
                Our AI actively trades a curated list of the <strong>top 20 performing tickers</strong>{' '}
                based on historical signal quality and performance metrics. This focused approach allows
                us to maximize win rates and minimize exposure to low-quality signals.
              </p>
            </div>

            <div className="bg-muted/50 p-4 rounded-lg space-y-3">
              <h4 className="font-semibold text-sm">How Tickers Get Promoted</h4>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="mt-0.5">
                    1
                  </Badge>
                  <p>
                    <strong>AI Confidence:</strong> Tickers with consistently high confidence scores
                    (based on technical and fundamental analysis)
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="mt-0.5">
                    2
                  </Badge>
                  <p>
                    <strong>Win Rate:</strong> Historical performance shows strong win rates and
                    risk-adjusted returns
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <Badge variant="outline" className="mt-0.5">
                    3
                  </Badge>
                  <p>
                    <strong>Signal Quality:</strong> Consistent signal generation with actionable
                    entry/exit levels
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-lg">
              <div className="flex items-start gap-3">
                <ArrowUpCircle className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm">
                  <strong>Weekly Updates:</strong> Every Sunday, our system automatically re-evaluates
                  ticker performance and updates the top 20 list. Poor performers are demoted, strong
                  performers stay or get promoted. This ensures we’re always trading the best opportunities.
                </p>
              </div>
            </div>

            <div>
              <h4 className="font-semibold text-sm mb-2">Typical Tickers Include:</h4>
              <div className="flex flex-wrap gap-2">
                {['AAPL', 'MSFT', 'NVDA', 'TSLA', 'META', 'GOOGL', 'AMZN', 'SPY', 'QQQ', 'COIN'].map(
                  (ticker) => (
                    <Badge key={ticker} variant="secondary">
                      {ticker}
                    </Badge>
                  )
                )}
                <Badge variant="outline">+ 10 more</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                * List dynamically updated based on performance
              </p>
            </div>
          </CardContent>
        </Card>

        {/* When We Trade */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-6 w-6 text-blue-600" />
              <CardTitle>When We Trade</CardTitle>
            </div>
            <CardDescription>Timing and execution strategy</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-semibold">Signal Generation</h4>
                <p className="text-sm text-muted-foreground">
                  Our AI analyzes markets <strong>24/7</strong> and generates signals when high-probability
                  setups are detected. Signals are validated in real-time before publication.
                </p>
              </div>
              <div className="space-y-2">
                <h4 className="font-semibold">Trade Execution</h4>
                <p className="text-sm text-muted-foreground">
                  Trades are executed during <strong>US market hours</strong> when liquidity is optimal.
                  Our system continuously monitors positions and adjusts stops/targets dynamically.
                </p>
              </div>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg">
              <div className="flex items-start gap-3">
                <Clock className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm">
                  <strong>Smart Timing:</strong> We avoid trading during low liquidity periods and major
                  news events that could cause unpredictable price action. Every signal includes optimal
                  entry, stop loss, and take profit levels.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* How We Trade */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-purple-600" />
              <CardTitle>How We Trade</CardTitle>
            </div>
            <CardDescription>Risk management and exit strategy</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div>
                <h4 className="font-semibold mb-2">Position Management</h4>
                <p className="text-sm text-muted-foreground">
                  Each position is sized based on risk tolerance (typically 0.75-1% of portfolio per trade)
                  with clearly defined stop loss levels. We never risk more than we can afford to lose.
                </p>
              </div>

              <div className="bg-muted/50 p-4 rounded-lg space-y-3">
                <h4 className="font-semibold text-sm">Exit Strategy</h4>
                <div className="grid gap-3">
                  <div>
                    <div className="flex items-center gap-2 font-medium text-sm mb-1">
                      <Target className="h-4 w-4 text-emerald-600" />
                      Take Profit Targets
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Profit targets vary by signal quality. High-probability setups target 1.5-3R while aggressive signals may have tighter targets (minimum 0.5R). Partial exits lock in gains while letting winners run.
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 font-medium text-sm mb-1">
                      <Shield className="h-4 w-4 text-blue-600" />
                      Trailing Stops
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Once a position moves into profit, we activate trailing stops to protect gains while
                      allowing for continued upside.
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 font-medium text-sm mb-1">
                      <Timer className="h-4 w-4 text-orange-600" />
                      Time-Based Exits
                    </div>
                    <p className="text-xs text-muted-foreground">
                      If a position becomes sideways/stagnant with small profit, we exit to free up capital
                      for better opportunities.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-purple-500/10 border border-purple-500/20 p-4 rounded-lg">
                <div className="flex items-start gap-3">
                  <Scale className="h-5 w-5 text-purple-600 flex-shrink-0 mt-0.5" />
                  <p className="text-sm">
                    <strong>Risk-Reward Focus:</strong> Every signal must meet minimum 0.5R reward-to-risk ratio (50¢ profit potential for every $1 risked). High-confidence setups typically target 1.5-3R. This selective approach, combined with our win rate, creates positive expected value.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Shadow Trading */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Cpu className="h-6 w-6 text-orange-600" />
              <CardTitle>Continuous Improvement</CardTitle>
            </div>
            <CardDescription>How we evolve and optimize performance</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2">Shadow Trading System</h4>
              <p className="text-sm text-muted-foreground mb-3">
                Behind the scenes, we run <strong>parallel virtual trading engines</strong> that test new
                strategies and parameters without risking real capital. This allows us to validate
                improvements before deploying them live.
              </p>
            </div>

            <div className="bg-orange-500/10 border border-orange-500/20 p-4 rounded-lg space-y-3">
              <div>
                <h4 className="font-semibold text-sm">What Shadow Trading Means for You</h4>
                <ul className="text-sm space-y-2 mt-2 list-disc list-inside text-muted-foreground">
                  <li>
                    <strong>Better Signals:</strong> We test new strategies in parallel before going live
                  </li>
                  <li>
                    <strong>No Risk:</strong> Shadow trades are virtual—they don’t affect your portfolio
                  </li>
                  <li>
                    <strong>Data-Driven:</strong> Only strategies that outperform get promoted to live
                    trading
                  </li>
                  <li>
                    <strong>Always Improving:</strong> Our system evolves based on real market performance
                  </li>
                </ul>
              </div>
            </div>

            <div>
              <p className="text-sm text-muted-foreground">
                When a shadow strategy proves itself (typically after 50+ trades with superior metrics), it
                can be promoted to become the primary live trading engine. This ensures we’re always using
                the best-performing approach.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Transparency */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Shield className="h-6 w-6 text-green-600" />
              <CardTitle>Transparency & Performance</CardTitle>
            </div>
            <CardDescription>Track our real results in real-time</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              All trades are tracked and displayed on our <strong>Performance</strong> page. You can see:
            </p>

            <div className="grid md:grid-cols-2 gap-3">
              <div className="bg-muted/50 p-3 rounded">
                <div className="font-semibold text-sm mb-1">📊 Real-Time Metrics</div>
                <p className="text-xs text-muted-foreground">
                  Win rate, average return per trade, profit factor, and drawdown
                </p>
              </div>
              <div className="bg-muted/50 p-3 rounded">
                <div className="font-semibold text-sm mb-1">💰 Live Equity Curve</div>
                <p className="text-xs text-muted-foreground">
                  See exactly how the portfolio grows over time
                </p>
              </div>
              <div className="bg-muted/50 p-3 rounded">
                <div className="font-semibold text-sm mb-1">📈 Trade History</div>
                <p className="text-xs text-muted-foreground">
                  Every entry, exit, and result logged transparently
                </p>
              </div>
              <div className="bg-muted/50 p-3 rounded">
                <div className="font-semibold text-sm mb-1">🎯 Ticker Performance</div>
                <p className="text-xs text-muted-foreground">
                  See which tickers perform best and why
                </p>
              </div>
            </div>

            <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg">
              <div className="flex items-start gap-3">
                <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                <p className="text-sm">
                  <strong>Full Transparency:</strong> We don’t hide losses or cherry-pick results. Every
                  trade—winning or losing—is logged and displayed. This accountability keeps us honest and
                  focused on long-term performance.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CTA */}
        <div className="text-center py-8 space-y-4">
          <h2 className="text-2xl font-bold">Ready to See It in Action?</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Check out our live performance metrics and see how the AI is performing in real-time. All
            results are updated continuously.
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/performance/overview"
              className="inline-flex items-center justify-center rounded-md bg-emerald-600 px-6 py-3 text-sm font-medium text-white hover:bg-emerald-700 transition-colors"
            >
              View Live Performance
            </Link>
            <Link
              href="/signals"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background px-6 py-3 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              See Current Signals
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
