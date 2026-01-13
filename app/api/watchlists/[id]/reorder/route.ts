import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    { error: 'DEPRECATED', message: 'Watchlists have been removed.' },
    { status: 410 }
  );
}
