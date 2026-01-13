// Legacy TradeSignal helpers. Manual TradeSignal requests have been removed from the product.
// These exports are kept as stubs to avoid breaking older imports.

import type { TradeSignalRequest, TradeSignalResponse } from '@/types/tradesignal';

export async function requestTradeSignal(
  _request: TradeSignalRequest
): Promise<TradeSignalResponse> {
  throw new Error('Manual TradeSignal requests have been removed. Use engine-generated signals only.');
}

export function calculateAgeMinutes(_updatedAt: string): number {
  return 0;
}

export function shouldShowRefreshButton(
  _ageMinutes: number,
  _isPro: boolean
): boolean {
  return false;
}
