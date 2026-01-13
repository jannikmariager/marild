import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { Sidebar } from '@/components/layout/sidebar';
import { UserProvider } from '@/components/providers/user-provider';
import { QueryProvider } from '@/components/providers/query-provider';
import { BACKTEST_VERSION } from '@/lib/backtest/version';
import { SubscriptionGate } from '@/components/billing/SubscriptionGate';
import { headers } from 'next/headers';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Skip auth check if somehow this layout runs for root
  const headersList = await headers();
  const pathname = headersList.get('x-pathname') || '';
  if (pathname === '/') {
    return <>{children}</>;
  }

  let user;
  try {
    user = await getCurrentUser();
  } catch (error) {
    console.error('Error in getCurrentUser:', error);
    user = null;
  }

  if (!user) {
    redirect('/login');
  }

  return (
    <QueryProvider>
      <UserProvider user={user}>
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 ml-60">
            <SubscriptionGate>
              {children}
              <div className="fixed bottom-2 right-2 text-xs text-gray-600">
                Backtest Engine: V{BACKTEST_VERSION}
              </div>
            </SubscriptionGate>
          </main>
        </div>
      </UserProvider>
    </QueryProvider>
  );
}
