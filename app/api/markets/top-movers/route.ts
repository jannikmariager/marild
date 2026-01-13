import { NextRequest, NextResponse } from 'next/server';

// Top Movers API removed – replaced by AI-trade based metrics.
export async function GET(request: NextRequest) {
  return NextResponse.json(
    { error: 'DEPRECATED', message: 'This endpoint has been removed in favour of AI trade metrics.' },
    { status: 410 }
  );
}
