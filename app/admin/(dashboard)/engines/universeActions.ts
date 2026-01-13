'use server'

import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/server'

export type Horizon = 'day' | 'swing' | 'invest'

function getUniverseName(horizon: Horizon): string {
  return `performance_${horizon}`
}

export async function promoteTickerToPerformance(ticker: string, horizon: Horizon) {
  const supabase = await createAdminClient()
  const universeName = getUniverseName(horizon)

  const { data, error } = await supabase
    .from('engine_universe')
    .select('id, tickers')
    .eq('universe_name', universeName)
    .maybeSingle()

  if (error || !data) {
    console.error(`[admin/promoteTickerToPerformance] failed to load universe ${universeName}`, error)
    throw error ?? new Error(`Universe ${universeName} not found`)
  }

  const current = ((data.tickers as string[]) || []).map((t) => t.toUpperCase())
  const tickerUpper = ticker.toUpperCase()

  if (current.includes(tickerUpper)) return

  const updated = [...current, tickerUpper]

  const { error: updateError } = await supabase
    .from('engine_universe')
    .update({ tickers: updated })
    .eq('id', data.id)

  if (updateError) {
    console.error('[admin/promoteTickerToPerformance] update failed', updateError)
    throw updateError
  }

  revalidatePath('/admin/engines')
  return { success: true }
}

export async function demoteTickerFromPerformance(ticker: string, horizon: Horizon) {
  const supabase = await createAdminClient()
  const universeName = getUniverseName(horizon)

  const { data, error } = await supabase
    .from('engine_universe')
    .select('id, tickers')
    .eq('universe_name', universeName)
    .maybeSingle()

  if (error || !data) {
    console.error(`[admin/demoteTickerFromPerformance] failed to load universe ${universeName}`, error)
    throw error ?? new Error(`Universe ${universeName} not found`)
  }

  const current = ((data.tickers as string[]) || []).map((t) => t.toUpperCase())
  const tickerUpper = ticker.toUpperCase()

  if (!current.includes(tickerUpper)) return

  const updated = current.filter((t) => t !== tickerUpper)

  const { error: updateError } = await supabase
    .from('engine_universe')
    .update({ tickers: updated })
    .eq('id', data.id)

  if (updateError) {
    console.error('[admin/demoteTickerFromPerformance] update failed', updateError)
    throw updateError
  }

  revalidatePath('/admin/engines')
  return { success: true }
}
