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
  try {
    return await fetchLatestFromAlpaca(symbols)
  } catch (error) {
    console.error('[fetchLatestMinuteBars] Alpaca fetch failed, falling back to Yahoo Finance', error)
    const yahooBars = await fetchLatestFromYahoo(symbols)
    if (Object.keys(yahooBars).length === 0) {
      throw error
    }
    return yahooBars
  }
}

async function fetchLatestFromAlpaca(symbols: string[]): Promise<Record<string, MinuteBar>> {
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

const YAHOO_MAX_BATCH = 50

async function fetchLatestFromYahoo(symbols: string[]): Promise<Record<string, MinuteBar>> {
  const chunks: string[][] = []
  for (let i = 0; i < symbols.length; i += YAHOO_MAX_BATCH) {
    chunks.push(symbols.slice(i, i + YAHOO_MAX_BATCH))
  }

  const result: Record<string, MinuteBar> = {}
  for (const chunk of chunks) {
    if (chunk.length === 0) continue
    const params = new URLSearchParams({ symbols: chunk.join(',') })
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?${params.toString()}`

    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json',
        },
        cache: 'no-store',
      })
      if (!res.ok) {
        console.error('[fetchLatestFromYahoo] HTTP error', res.status, await res.text())
        continue
      }
      const payload = await res.json()
      const quotes: Array<Record<string, unknown>> = payload?.quoteResponse?.result ?? []
      for (const quote of quotes) {
        const symbol = typeof quote.symbol === 'string' ? quote.symbol.toUpperCase() : null
        const price =
          typeof quote.regularMarketPrice === 'number'
            ? quote.regularMarketPrice
            : typeof quote.postMarketPrice === 'number'
              ? quote.postMarketPrice
              : null
        if (!symbol || price == null) continue
        const ts =
          typeof quote.regularMarketTime === 'number'
            ? new Date(quote.regularMarketTime * 1000).toISOString()
            : new Date().toISOString()
        result[symbol] = {
          o: price,
          h: price,
          l: price,
          c: price,
          t: ts,
        }
      }
      if (chunks.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 150))
      }
    } catch (err) {
      console.error('[fetchLatestFromYahoo] Error fetching chunk', err)
    }
  }
  return result
}
