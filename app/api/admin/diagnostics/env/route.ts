import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function requireAdminKey(request: NextRequest) {
  const expected = process.env.ADMIN_CRON_KEY
  if (!expected) throw new Error('ADMIN_CRON_KEY not configured')

  const header = request.headers.get('authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null
  const queryToken = request.nextUrl.searchParams.get('token')
  const supplied = bearer || queryToken

  if (!supplied || supplied !== expected) {
    throw new Error('Unauthorized')
  }
}

const envKeys = [
  // Required for Supabase access
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  // Admin auth
  'ADMIN_CRON_KEY',
  // OpenAI (required in prod; dev fallback may be used in previews)
  'OPENAI_API_KEY',

  // Optional / later
  'WEEKLY_REPORT_MODEL',
  'REPORT_AUTOGEN_ENABLED',
  'REPORT_AUTOPUBLISH_ENABLED',
  'REPORT_AUTOPOST_DRYRUN',
  'DISCORD_POST_WEEKLY_ENABLED',
  'DISCORD_POST_TRADES_ENABLED',
  'DISCORD_WEBHOOK_WEEKLY_REPORTS',
  'DISCORD_WEBHOOK_LIVE_EXECUTED_TRADES',
] as const

export async function GET(request: NextRequest) {
  try {
    requireAdminKey(request)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 })
  }

  const present: string[] = []
  const missing: string[] = []

  for (const key of envKeys) {
    const v = process.env[key]
    if (typeof v === 'string' && v.trim().length > 0) present.push(key)
    else missing.push(key)
  }

  return NextResponse.json({ present, missing })
}
