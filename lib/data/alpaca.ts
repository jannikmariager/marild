export interface MinuteBar {
  o: number
  h: number
  l: number
  c: number
  v?: number
  t: string
}

export interface AlpacaLatestBarsResponse {
  bars: Record<string, MinuteBar>
}

const MAX_BATCH = 200

function alpacaHeaders() {
  const API_KEY = process.env.ALPACA_API_KEY_ID
  const API_SECRET = process.env.ALPACA_API_SECRET_KEY
  if (!API_KEY || !API_SECRET) {
    throw new Error('Alpaca credentials missing (ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY)')
  }
  return {
    'APCA-API-KEY-ID': API_KEY,
    'APCA-API-SECRET-KEY': API_SECRET,
  }
}

export async function fetchLatestMinuteBars(symbols: string[]): Promise<Record<string, MinuteBar>> {
  const DATA_URL = process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets/v2'
  const FEED = process.env.ALPACA_DATA_FEED || 'iex'
  const chunks: string[][] = []
  for (let i = 0; i < symbols.length; i += MAX_BATCH) {
    chunks.push(symbols.slice(i, i + MAX_BATCH))
  }
  const result: Record<string, MinuteBar> = {}

  for (const chunk of chunks) {
    if (chunk.length === 0) continue
    const params = new URLSearchParams({ symbols: chunk.join(',') })
    if (FEED) params.set('feed', FEED)
    const url = `${DATA_URL}/stocks/bars/latest?${params.toString()}`
    const res = await fetch(url, { headers: alpacaHeaders() })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Alpaca latest bars failed (${res.status}): ${text}`)
    }
    const payload = (await res.json()) as { bars: Record<string, MinuteBar> }
    Object.assign(result, payload.bars)
    if (chunks.length > 1) {
      await new Promise((resolve) => setTimeout(resolve, 200)) // basic rate-limit spacing
    }
  }

  return result
}
