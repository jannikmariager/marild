import { NextResponse } from 'next/server';

// Manual TradeSignal request endpoint has been deprecated.
// Keep a lightweight handler that returns 410 Gone so stale clients fail gracefully.

export async function POST() {
  return NextResponse.json(
    {
      message: 'Manual TradeSignal requests have been removed. Signals are generated automatically from the Active Model Universe.',
    },
    { status: 410 },
  );
}
