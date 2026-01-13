# Premium Animated Ticker Performance Page

## Overview
This is a high-end, animated performance detail page for individual tickers at `/performance/[ticker]`.

## Route
- **URL Pattern:** `/performance/AAPL`, `/performance/TSLA`, etc.
- **Dynamic Parameter:** `[ticker]` - ticker symbol (case-insensitive)

## Features Implemented

### ✅ Core Animations
1. **Staggered Page Load**
   - 80ms delay between sections
   - Breadcrumb → Header → Tabs → Metrics → Chart → Panels
   - Fade-in with 15px translateY

2. **Smooth Tab Transitions**
   - Daytrade / Swing / Live tabs
   - Crossfade content with horizontal slide
   - 200ms duration with ease-out

3. **Animated Metrics Row**
   - 5 key metrics cards (Win Rate, Expectancy, Max DD, Trades, Sharpe)
   - Hover: scale 1.02 + shadow intensify
   - Tooltips with metric explanations
   - Value change flashes:
     - Green background flash for improvements
     - Amber flash for declines
   - Spring-physics number tweening

4. **Interactive Equity Curve**
   - Line drawing animation (700ms)
   - Hover tooltips with date, equity, return %
   - Active dot marker on hover
   - Zoom controls (3M / 6M / 1Y / All) with smooth transitions
   - Gradient fill under curve

5. **Quality Score Stars**
   - 1-5 star rating based on expectancy, win rate, drawdown
   - Sequential fill animation (100ms stagger)
   - Spring-type entrance

6. **Loading States**
   - Comprehensive shimmer skeleton
   - Matches actual page layout
   - Smooth transition to loaded state

7. **Error & Empty States**
   - Slide-down error banner with retry button
   - Gentle floating animation for empty state icon
   - Clear messaging

### 🎯 Accessibility
- **Reduced Motion Support:** All animations respect `prefers-reduced-motion`
- **Keyboard Navigation:** Full tab and focus support
- **ARIA Labels:** Proper semantic HTML
- **Tooltips:** Contextual help on hover

### 📊 Data Integration
- Fetches from existing `/api/performance/universe` endpoint
- Loads per-ticker equity curves from `/api/performance/backtest-equity`
- No new backend logic required
- Graceful degradation for missing data

## Component Structure

```
app/(app)/performance/[ticker]/
├── page.tsx                              # Server component, metadata
├── components/
│   ├── TickerPerformanceClient.tsx      # Main client orchestrator
│   ├── AnimatedTickerHeader.tsx         # Header with live dot + badges
│   ├── AnimatedMetricsRow.tsx           # 5 metric cards with tooltips
│   ├── AnimatedEquityCurve.tsx          # Chart with zoom + hover
│   ├── AnimatedSecondaryPanels.tsx      # Quality score + summary
│   ├── TickerPerformanceSkeleton.tsx    # Loading skeleton
│   ├── AnimatedErrorState.tsx           # Error UI
│   └── AnimatedEmptyState.tsx           # Empty state UI
```

## Animation Timings
- **Page Load Stagger:** 80ms between sections
- **Fade Duration:** 200-250ms
- **Tab Transition:** 150-200ms
- **Metric Value Tween:** Spring physics (stiffness: 100, damping: 30)
- **Value Change Flash:** 150ms
- **Equity Line Draw:** 700ms
- **Star Fill Stagger:** 100ms per star
- **Reduced Motion:** All animations → 0-150ms or disabled

## Premium UX Details
1. **Back Link:** Arrow slides left on hover
2. **View in Markets Button:** Gradient hover effect
3. **Live Indicator:** Pulsing green dot (2s cycle)
4. **Metric Cards:** Shadow intensifies on hover
5. **Zoom Pills:** Scale 1.05 on hover, 0.97 on tap
6. **Tooltips:** 200ms delay, dark theme
7. **Chart Gradient:** Blue gradient fill under line
8. **Quality Stars:** Gold (#fbbf24) for filled, gray for empty

## Usage Example

Navigate to: `/performance/AAPL`

The page will:
1. Load ticker data from universe API
2. Display staggered entry animations
3. Show Daytrade, Swing tabs (if approved)
4. Allow tab switching with smooth crossfades
5. Display animated metrics with tooltips
6. Render interactive equity curve with zoom
7. Show quality score and summary stats

## Dependencies
- `framer-motion` - Animation library
- `recharts` - Chart rendering
- `date-fns` - Date formatting
- `lucide-react` - Icons
- Existing shadcn/ui components (Card, Tabs, Tooltip, etc.)

## Notes
- Live trading tab is shown if ticker has daytrade approval
- Quality score algorithm: combines expectancy (60%), win rate (20%), drawdown penalty (20%)
- All animations respect user's motion preferences
- Tooltips provide educational context for metrics
- Chart auto-adjusts Y-axis based on zoom range
- Skeleton matches final layout 1:1

## Future Enhancements (Not Yet Implemented)
- Live P&L updates with arrows (requires WebSocket or polling)
- Trade distribution histogram
- Rolling metrics sparklines
- Real-time position table animations
