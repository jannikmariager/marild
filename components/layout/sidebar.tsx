'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, ListCheck, TrendingUp, Sparkles, Newspaper, User, Settings, LogOut, Lightbulb, LineChart, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabaseBrowser';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: Home },
  // Insights temporarily hidden from sidebar
  // { href: '/insights', label: 'Insights', icon: Lightbulb },
  {
    href: '/performance',
    label: 'Performance',
    icon: LineChart,
    children: [
      { href: '/performance/journal', label: 'Trading Journal' },
      { href: '/performance/overview', label: 'Overview' },
    ],
  },
  // Watchlist removed – model trades only its own active universe
  // { href: '/watchlist', label: 'Watchlist', icon: ListCheck },
  { href: '/tradesignals', label: 'TradeSignals', icon: Sparkles },
  { href: '/markets', label: 'Markets', icon: TrendingUp },
  { href: '/how-it-works', label: 'How It Works', icon: Info },
  // News hidden for now
  // { href: '/news', label: 'News', icon: Newspaper },
  { href: '/account', label: 'Account', icon: User },
];

export function Sidebar() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const marketingUrl = process.env.NEXT_PUBLIC_MARKETING_URL || 'http://localhost:3001';

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    if (typeof window !== 'undefined') {
      window.location.href = marketingUrl;
    } else {
      router.push('/');
      router.refresh();
    }
  };

  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-60 border-r bg-card">
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className="flex h-16 items-center border-b px-6">
          <Link href="/dashboard" className="flex items-center space-x-2">
            <Image
              src="/assets/marild_logo.jpeg"
              alt="Marild logo"
              width={120}
              height={32}
              priority
            />
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 p-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isSectionActive = pathname === item.href || pathname.startsWith(item.href + '/');

            if (!('children' in item) || !item.children) {
              const isActive = isSectionActive;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center space-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
              );
            }

            // Performance section with visible subpages
            const parentActive = isSectionActive;

            return (
              <div key={item.href} className="space-y-0.5">
                {/* Main Performance button now goes directly to Live Portfolio */}
                <Link
                  href="/performance/live"
                  className={cn(
                    'flex items-center space-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    parentActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
                <div className="ml-8 space-y-0.5">
                  {item.children.map((child) => {
                    const childActive = pathname === child.href;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          'flex items-center rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors',
                          childActive
                            ? 'bg-muted text-foreground border-l-2 border-l-primary'
                            : 'hover:bg-accent hover:text-accent-foreground',
                        )}
                      >
                        <span>{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Bottom actions */}
        <div className="border-t p-4 space-y-1">
          <Link
            href="/settings"
            className={cn(
              'flex items-center space-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              pathname === '/settings'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )}
          >
            <Settings className="h-5 w-5" />
            <span>Settings</span>
          </Link>
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground"
            onClick={handleLogout}
          >
            <LogOut className="mr-3 h-5 w-5" />
            Logout
          </Button>
        </div>
      </div>
    </aside>
  );
}
