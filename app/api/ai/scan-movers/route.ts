import { NextRequest, NextResponse } from 'next/server';

// Deprecated: legacy AI scan for generic top movers. No longer used.
export async function POST(req: NextRequest) {
  return NextResponse.json(
    { error: 'DEPRECATED', message: 'This endpoint has been removed. Use AI trade analytics instead.' },
    { status: 410 }
  );
}
