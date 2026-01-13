'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface UpgradeButtonProps {
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
  children?: React.ReactNode;
}

export function UpgradeButton({ 
  className, 
  variant = 'default', 
  size = 'default',
  children = 'Upgrade to PRO'
}: UpgradeButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/stripe/create-checkout', { method: 'POST' });
      
      if (!res.ok) {
        const debugHeader = res.headers.get('X-Debug-Stripe-Error');
        const errBody = await res.json().catch(() => ({} as any));
        const msg = errBody?.message || errBody?.error || debugHeader || 'Failed to create checkout session';
        throw new Error(msg);
      }
      
      const data = await res.json();
      
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (e) {
      console.error('Upgrade error:', e);
      alert('Unable to start upgrade process. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button 
      onClick={handleUpgrade} 
      disabled={loading}
      variant={variant}
      size={size}
      className={className}
    >
      {loading ? 'Redirecting to checkout...' : children}
    </Button>
  );
}
