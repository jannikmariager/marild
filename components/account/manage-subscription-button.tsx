'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

export function ManageSubscriptionButton() {
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/billing/portal', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.message || 'Failed to create billing portal session');
      }
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (e) {
      console.error(e);
      if (e instanceof Error && e.message) {
        alert(e.message);
      } else {
        alert('Unable to open billing portal. Please try again later.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={handleClick} disabled={loading}>
      {loading ? 'Redirecting…' : 'Manage Subscription'}
    </Button>
  );
}
