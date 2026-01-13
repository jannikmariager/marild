'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { useUser } from '@/components/providers/user-provider';
import { getDevModeLabel } from '@/lib/subscription/devOverride';
import { useRouter } from 'next/navigation';

interface TopbarProps {
  title: string;
}

export function Topbar({ title }: TopbarProps) {
  const user = useUser();
  const router = useRouter();


  const getTierBadge = () => {
    if (!user) return null;

    // Check for DEV mode override
    const devLabel = getDevModeLabel();
    if (devLabel) {
      return (
        <Badge className="bg-orange-500">
          {devLabel}
        </Badge>
      );
    }

    const tierKey = user.subscription_tier ?? 'free';

    const tierColors: Record<string, string> = {
      free: 'bg-gray-600',
      pro: 'bg-[#0AAE84] text-black',
      expired: 'bg-gray-500',
    };

    const tierLabels: Record<string, string> = {
      free: 'FREE · No signals',
      pro: 'PRO',
      expired: 'EXPIRED',
    };

    return (
      <Badge className={tierColors[tierKey] ?? 'bg-gray-600'}>
        {tierLabels[tierKey] ?? 'FREE'}
      </Badge>
    );
  };

  const getInitials = () => {
    if (!user?.email) return 'U';
    return user.email.charAt(0).toUpperCase();
  };

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center border-b bg-background px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">{title}</h1>
      </div>
      
      <div className="ml-auto flex items-center space-x-4">
        {/* User menu */}
        <div className="flex items-center space-x-2">
          {getTierBadge()}
          <button
            type="button"
            onClick={() => router.push('/account')}
            className="rounded-full focus:ring-2 focus:ring-offset-2 focus:ring-primary"
            aria-label="Account settings"
          >
            <Avatar>
              <AvatarFallback>{getInitials()}</AvatarFallback>
            </Avatar>
          </button>
        </div>
      </div>
    </header>
  );
}
