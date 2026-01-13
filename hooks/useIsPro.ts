'use client';

import { useUser } from '@/components/providers/user-provider';
import { isProUser } from '@/lib/auth';

/**
 * Client-side hook to check if user has PRO subscription
 * Uses the user from UserProvider context
 */
export function useIsPro(): boolean {
  const user = useUser();
  return isProUser(user);
}
