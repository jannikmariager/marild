import { NextRequest, NextResponse } from 'next/server'
import { requireJobAuth } from '@/lib/jobs/auth'
import { JobLogger } from '@/lib/jobs/jobLogger'
import { dispatchOutboundPosts } from '@/lib/reports/outbound/dispatcher'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    requireJobAuth(request)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  const logger = new JobLogger('outbound_dispatch')
  await logger.start()

  try {
    await dispatchOutboundPosts({ limit: 25 })
    await logger.finish(true, { ok: true })
    return NextResponse.json({ ok: true })
  } catch (err) {
    await logger.finish(false, {}, err instanceof Error ? err.message : String(err))
    return NextResponse.json({ error: 'internal_error' }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  return POST(request)
}
