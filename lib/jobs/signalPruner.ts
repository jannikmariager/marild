import { DateTime } from 'luxon'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const DEFAULT_INACTIVE_STATUSES = ['filled', 'tp_hit', 'sl_hit', 'timed_out', 'expired', 'invalidated']

export interface SignalPruneOptions {
  cutoffHours?: number
  beforeIso?: string
  includeActive?: boolean
  dryRun?: boolean
  statuses?: string[]
}

export interface SignalPruneResult {
  cutoffIso: string
  deleted?: number
  preview?: number
  statuses?: string[]
  includeActive: boolean
}

function sanitizeHours(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return 72
  }
  if (value < 0) return 0
  return value
}

export async function pruneSignals(options: SignalPruneOptions = {}): Promise<SignalPruneResult> {
  const cutoffHours = sanitizeHours(options.cutoffHours)
  const includeActive = options.includeActive ?? false
  const dryRun = options.dryRun ?? false
  const statuses = options.statuses ?? (includeActive ? undefined : DEFAULT_INACTIVE_STATUSES)

  const cutoff = options.beforeIso
    ? DateTime.fromISO(options.beforeIso, { zone: 'utc' })
    : DateTime.utc().minus({ hours: cutoffHours })

  if (!cutoff.isValid) {
    throw new Error('Invalid cutoff timestamp supplied to pruneSignals')
  }

  const cutoffIso = cutoff.toISO()

  const applyFilters = (query: any) => {
    let filtered = query.lt('updated_at', cutoffIso)
    if (statuses && statuses.length > 0) {
      filtered = filtered.in('status', statuses)
    }
    return filtered
  }

  if (dryRun) {
    const { count, error } = await applyFilters(
      supabaseAdmin.from('ai_signals').select('id', { count: 'exact', head: true }),
    )

    if (error) {
      throw new Error(error.message)
    }

    return {
      cutoffIso,
      preview: count ?? 0,
      statuses,
      includeActive,
    }
  }

  const { count, error } = await applyFilters(supabaseAdmin.from('ai_signals').delete({ count: 'exact' }))

  if (error) {
    throw new Error(error.message)
  }

  return {
    cutoffIso,
    deleted: count ?? 0,
    statuses,
    includeActive,
  }
}
