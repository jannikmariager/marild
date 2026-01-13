'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CheckCircle, Loader2 } from 'lucide-react';
import { resolveAlert } from '@/app/admin/(dashboard)/errors/actions';
import { useRouter } from 'next/navigation';

interface ResolveAlertButtonProps {
  alertId: string;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function ResolveAlertButton({ alertId, variant = 'ghost', size = 'sm' }: ResolveAlertButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  async function handleResolve() {
    setIsLoading(true);
    try {
      await resolveAlert(alertId);
      router.refresh();
    } catch (error) {
      console.error('Failed to resolve alert:', error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleResolve}
      disabled={isLoading}
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <>
          <CheckCircle className="h-4 w-4 mr-2" />
          Resolve
        </>
      )}
    </Button>
  );
}
