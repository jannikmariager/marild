/**
 * SMC Detection Logic
 * Detects Order Blocks, Break of Structure, Sessions, and Ranges
 */

export interface OHLCBar {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SwingPoint {
  index: number;
  price: number;
  type: 'high' | 'low';
  timestamp: string;
}

export interface OrderBlockData {
  direction: 'bullish' | 'bearish';
  high: number;
  low: number;
  open_time: string;
  close_time: string;
  origin: boolean;
}

export interface BOSEventData {
  direction: 'up' | 'down';
  price: number;
  event_time: string;
  strength: number;
}

export interface SessionRangeData {
  session_type: string;
  high: number;
  low: number;
  open_time: string;
  close_time: string;
  session_date: string;
}

/**
 * Detect swing highs and lows in price data
 */
export function detectSwingPoints(bars: OHLCBar[], lookback = 5): SwingPoint[] {
  const swingPoints: SwingPoint[] = [];
  
  for (let i = lookback; i < bars.length - lookback; i++) {
    const bar = bars[i];
    
    // Check for swing high
    let isSwingHigh = true;
    for (let j = 1; j <= lookback; j++) {
      if (bars[i - j].high >= bar.high || bars[i + j].high >= bar.high) {
        isSwingHigh = false;
        break;
      }
    }
    if (isSwingHigh) {
      swingPoints.push({
        index: i,
        price: bar.high,
        type: 'high',
        timestamp: bar.timestamp,
      });
    }
    
    // Check for swing low
    let isSwingLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (bars[i - j].low <= bar.low || bars[i + j].low <= bar.low) {
        isSwingLow = false;
        break;
      }
    }
    if (isSwingLow) {
      swingPoints.push({
        index: i,
        price: bar.low,
        type: 'low',
        timestamp: bar.timestamp,
      });
    }
  }
  
  return swingPoints.sort((a, b) => a.index - b.index);
}

/**
 * Detect Break of Structure events
 * BOS Up = close above previous swing high
 * BOS Down = close below previous swing low
 */
export function detectBOS(bars: OHLCBar[], swingPoints: SwingPoint[]): BOSEventData[] {
  const bosEvents: BOSEventData[] = [];
  const swingHighs = swingPoints.filter(s => s.type === 'high');
  const swingLows = swingPoints.filter(s => s.type === 'low');
  
  let lastSwingHigh: SwingPoint | null = null;
  let lastSwingLow: SwingPoint | null = null;
  
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    
    // Update last swing high/low
    const swingHigh = swingHighs.find(s => s.index === i);
    if (swingHigh) lastSwingHigh = swingHigh;
    
    const swingLow = swingLows.find(s => s.index === i);
    if (swingLow) lastSwingLow = swingLow;
    
    // Check for BOS up (close above previous swing high)
    if (lastSwingHigh && bar.close > lastSwingHigh.price) {
      const priceMove = bar.close - lastSwingHigh.price;
      const strength = Math.min(priceMove / lastSwingHigh.price, 0.1) * 10; // Normalize to 0-1
      
      bosEvents.push({
        direction: 'up',
        price: bar.close,
        event_time: bar.timestamp,
        strength: Math.min(strength, 1.0),
      });
      
      lastSwingHigh = null; // Reset to avoid duplicate BOS
    }
    
    // Check for BOS down (close below previous swing low)
    if (lastSwingLow && bar.close < lastSwingLow.price) {
      const priceMove = lastSwingLow.price - bar.close;
      const strength = Math.min(priceMove / lastSwingLow.price, 0.1) * 10;
      
      bosEvents.push({
        direction: 'down',
        price: bar.close,
        event_time: bar.timestamp,
        strength: Math.min(strength, 1.0),
      });
      
      lastSwingLow = null;
    }
  }
  
  return bosEvents;
}

/**
 * Detect Order Blocks
 * Bullish OB = last down candle before impulsive move up (BOS up)
 * Bearish OB = last up candle before impulsive move down (BOS down)
 */
export function detectOrderBlocks(bars: OHLCBar[], bosEvents: BOSEventData[]): OrderBlockData[] {
  const orderBlocks: OrderBlockData[] = [];
  
  for (const bos of bosEvents) {
    // Find the bar index for this BOS event
    const bosIndex = bars.findIndex(b => b.timestamp === bos.event_time);
    if (bosIndex < 5) continue; // Need history
    
    if (bos.direction === 'up') {
      // Find last bearish candle before BOS up
      for (let i = bosIndex - 1; i >= Math.max(0, bosIndex - 10); i--) {
        const bar = bars[i];
        if (bar.close < bar.open) { // Bearish candle
          orderBlocks.push({
            direction: 'bullish',
            high: bar.high,
            low: bar.low,
            open_time: bar.timestamp,
            close_time: bar.timestamp,
            origin: false,
          });
          break;
        }
      }
    } else {
      // Find last bullish candle before BOS down
      for (let i = bosIndex - 1; i >= Math.max(0, bosIndex - 10); i--) {
        const bar = bars[i];
        if (bar.close > bar.open) { // Bullish candle
          orderBlocks.push({
            direction: 'bearish',
            high: bar.high,
            low: bar.low,
            open_time: bar.timestamp,
            close_time: bar.timestamp,
            origin: false,
          });
          break;
        }
      }
    }
  }
  
  // Mark origin OBs (first OB in a significant trend)
  if (orderBlocks.length > 0) {
    orderBlocks[0].origin = true;
    if (orderBlocks.length > 5) {
      orderBlocks[Math.floor(orderBlocks.length / 2)].origin = true;
    }
  }
  
  return orderBlocks;
}

/**
 * Calculate session ranges
 * NY: 9:30 AM - 4:00 PM EST
 * Previous Day, 4H, 1H ranges
 */
export function calculateSessionRanges(bars: OHLCBar[], ticker: string): SessionRangeData[] {
  const sessions: SessionRangeData[] = [];
  
  if (bars.length < 24) return sessions; // Need enough data
  
  // Group bars by date
  const barsByDate = new Map<string, OHLCBar[]>();
  for (const bar of bars) {
    const date = bar.timestamp.split('T')[0];
    if (!barsByDate.has(date)) {
      barsByDate.set(date, []);
    }
    barsByDate.get(date)!.push(bar);
  }
  
  // Calculate previous day range
  const dates = Array.from(barsByDate.keys()).sort();
  if (dates.length >= 2) {
    const prevDate = dates[dates.length - 2];
    const prevBars = barsByDate.get(prevDate)!;
    const high = Math.max(...prevBars.map(b => b.high));
    const low = Math.min(...prevBars.map(b => b.low));
    
    sessions.push({
      session_type: 'PREV_DAY',
      high,
      low,
      open_time: prevBars[0].timestamp,
      close_time: prevBars[prevBars.length - 1].timestamp,
      session_date: prevDate,
    });
  }
  
  // Calculate previous 4H range (last 16 bars if 15min, last 4 bars if 1h)
  const prev4H = bars.slice(Math.max(0, bars.length - 16), bars.length);
  if (prev4H.length > 0) {
    sessions.push({
      session_type: 'PREV_4H',
      high: Math.max(...prev4H.map(b => b.high)),
      low: Math.min(...prev4H.map(b => b.low)),
      open_time: prev4H[0].timestamp,
      close_time: prev4H[prev4H.length - 1].timestamp,
      session_date: prev4H[0].timestamp.split('T')[0],
    });
  }
  
  // Calculate previous 1H range
  const prev1H = bars.slice(Math.max(0, bars.length - 4), bars.length);
  if (prev1H.length > 0) {
    sessions.push({
      session_type: 'PREV_1H',
      high: Math.max(...prev1H.map(b => b.high)),
      low: Math.min(...prev1H.map(b => b.low)),
      open_time: prev1H[0].timestamp,
      close_time: prev1H[prev1H.length - 1].timestamp,
      session_date: prev1H[0].timestamp.split('T')[0],
    });
  }
  
  return sessions;
}

/**
 * Check if an order block has been mitigated
 * Mitigated = price traded back through OB and closed inside/through it
 */
export function checkMitigation(
  ob: OrderBlockData,
  bars: OHLCBar[],
  obIndex: number
): { mitigated: boolean; mitigation_time: string | null } {
  // Find bars after OB formation
  const obTime = new Date(ob.close_time).getTime();
  
  for (let i = obIndex + 1; i < bars.length; i++) {
    const bar = bars[i];
    const barTime = new Date(bar.timestamp).getTime();
    
    if (barTime <= obTime) continue;
    
    if (ob.direction === 'bullish') {
      // Bullish OB mitigated if price closes below OB low
      if (bar.close < ob.low) {
        return { mitigated: true, mitigation_time: bar.timestamp };
      }
    } else {
      // Bearish OB mitigated if price closes above OB high
      if (bar.close > ob.high) {
        return { mitigated: true, mitigation_time: bar.timestamp };
      }
    }
  }
  
  return { mitigated: false, mitigation_time: null };
}
