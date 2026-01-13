import { redirect } from 'next/navigation';

// Manual TradeSignal request flow has been removed.
// Keep this route as a soft redirect in case of stale links.

export default function TradeSignalRedirectPage() {
  redirect('/tradesignals');
}
