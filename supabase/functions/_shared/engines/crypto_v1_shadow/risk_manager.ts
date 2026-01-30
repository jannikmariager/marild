import type { CryptoShadowConfig } from '../../config.ts';
import type { SizingResult, RuleDecision } from './types.ts';

export function sizePosition(
  equity: number,
  decision: RuleDecision,
  config: CryptoShadowConfig,
): SizingResult | null {
  if (!decision.entry || !decision.stop) return null;
  const R = Math.abs(decision.entry - decision.stop);
  if (R <= 0) return null;

  const riskUsd = equity * config.riskPerTrade;
  let qty = riskUsd / R;

  // cap notional to 25% equity
  const notional = qty * decision.entry;
  const maxNotional = equity * 0.25;
  if (notional > maxNotional) {
    qty = maxNotional / decision.entry;
  }

  if (qty <= 0) return null;

  return {
    qty,
    notional: qty * decision.entry,
    riskUsd,
    R,
  };
}

export function applyFeeSlippage(
  price: number,
  config: CryptoShadowConfig,
  side: 'buy' | 'sell',
): number {
  const slippage = config.slippageBps / 10000;
  const fee = config.feeBps / 10000;
  const adj = 1 + fee + slippage;
  if (side === 'buy') return price * adj;
  return price * (1 - (fee + slippage));
}
