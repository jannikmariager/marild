import { NextRequest } from 'next/server'

const TOKENS = [process.env.JOB_CRON_SECRET, process.env.CRON_SECRET].filter(
  (value): value is string => Boolean(value),
)

export function requireJobAuth(request: NextRequest) {
  if (TOKENS.length === 0) {
    throw new Error('JOB_CRON_SECRET or CRON_SECRET not configured')
  }
  const header = request.headers.get('authorization')
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null
  const queryToken = request.nextUrl.searchParams.get('token')
  const supplied = bearer || queryToken
  if (!supplied || !TOKENS.includes(supplied)) {
    throw new Error('Unauthorized job invocation')
  }
}
