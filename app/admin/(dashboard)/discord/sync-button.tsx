'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { syncDiscordStats } from './actions';
import { useRouter } from 'next/navigation';

export function SyncDiscordButton() {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  async function handleSync() {
    setIsLoading(true);
    try {
      const result = await syncDiscordStats();
      
      if (result.success) {
        router.refresh();
      } else {
        console.error('Failed to sync Discord stats:', result.error);
        alert(`Failed to sync: ${result.error}`);
      }
    } catch (error) {
      console.error('Error syncing Discord stats:', error);
      alert('Failed to sync Discord stats');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Button
      onClick={handleSync}
      disabled={isLoading}
      variant="outline"
    >
      <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
      {isLoading ? 'Syncing...' : 'Sync Stats'}
    </Button>
  );
}
