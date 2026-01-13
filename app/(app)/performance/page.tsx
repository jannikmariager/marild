import { redirect } from 'next/navigation';

export default function PerformancePage() {
  // /performance should be the entry point for the Live Portfolio
  redirect('/performance/live');
}
