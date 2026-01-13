import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function deprecatedResponse() {
  return NextResponse.json(
    { error: 'DEPRECATED', message: 'Watchlists have been removed.' },
    { status: 410 }
  );
}

export async function GET(_request: NextRequest) {
  return deprecatedResponse();
}

export async function POST(_request: NextRequest) {
  return deprecatedResponse();
}
