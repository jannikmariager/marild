import { redirect } from 'next/navigation';

export default function WatchlistPage() {
  // Watchlist has been removed – redirect to dashboard where model universe is shown
  redirect('/dashboard');
}
