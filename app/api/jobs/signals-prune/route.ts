import { NextRequest, NextResponse } from 'next/server'
import { requireJobAuth } from '@/lib/jobs/auth'
import { JobLogger } from '@/lib/jobs/jobLogger'
import { pruneSignals } from '@/lib/jobs/signalPruner'

async function handle(request: NextRequest) {
  try {
    requireJobAuth(request)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  const logger = new JobLogger('signals_prune')
  await logger.start()

  const params = new URL(request.url).searchParams
  const cutoffHours = Number(params.get('hours') ?? '72')
  const beforeIso = params.get('before') ?? undefined
  const includeActive = params.get('includeActive') === 'true'
  const dryRun = params.get('dryRun') === 'true'
  const statusesParam = params.get('statuses')
  const statuses = statusesParam ? statusesParam.split(',').map((s) => s.trim()).filter(Boolean) : undefined

  try {
    const result = await pruneSignals({
      cutoffHours,
      beforeIso,
      includeActive,
      dryRun,
      statuses,
    })

    await logger.finish(true, { deleted: result.deleted ?? 0, preview: result.preview ?? 0 }, undefined, {
      cutoffIso: result.cutoffIso,
      includeActive: result.includeActive,
      statuses: result.statuses,
      dryRun,
    })

    return NextResponse.json({ ok: true, ...result, dryRun })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await logger.finish(false, {}, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  return handle(request)
}

export async function GET(request: NextRequest) {
  return handle(request)
}
