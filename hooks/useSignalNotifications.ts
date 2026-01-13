'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY = 'last_signal_check';

interface SignalCheckResponse {
  latest_signal_time: string | null;
  count: number;
}

export function useSignalNotifications() {
  const lastCheckRef = useRef<string | null>(null);

  useEffect(() => {
    // Initialize last check time from localStorage
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      lastCheckRef.current = stored;
    } else {
      // Set initial check time to now
      const now = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, now);
      lastCheckRef.current = now;
    }

    async function checkForNewSignals() {
      try {
        const response = await fetch('/api/tradesignals/check-new');
        if (!response.ok) return;

        const data: SignalCheckResponse = await response.json();

        // If there are new signals since last check
        if (data.latest_signal_time && lastCheckRef.current) {
          const latestSignalTime = new Date(data.latest_signal_time).getTime();
          const lastCheckTime = new Date(lastCheckRef.current).getTime();

          if (latestSignalTime > lastCheckTime && data.count > 0) {
            // Show toast notification
            toast.success(`${data.count} new signal${data.count > 1 ? 's' : ''} available`, {
              description: 'Click to view the latest AI trading signals',
              duration: 8000,
              action: {
                label: 'View',
                onClick: () => {
                  // Refresh the page to show new signals
                  window.location.reload();
                },
              },
            });

            // Update last check time
            const now = new Date().toISOString();
            localStorage.setItem(STORAGE_KEY, now);
            lastCheckRef.current = now;
          }
        }
      } catch (error) {
        console.error('Error checking for new signals:', error);
      }
    }

    // Check immediately on mount (but only if last check was > 5 min ago)
    const storedTime = localStorage.getItem(STORAGE_KEY);
    if (storedTime) {
      const lastCheck = new Date(storedTime).getTime();
      const now = Date.now();
      if (now - lastCheck > POLL_INTERVAL) {
        checkForNewSignals();
      }
    }

    // Set up polling interval
    const intervalId = setInterval(checkForNewSignals, POLL_INTERVAL);

    return () => clearInterval(intervalId);
  }, []);
}
