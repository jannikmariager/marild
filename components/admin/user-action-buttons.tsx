'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Ban, CheckCircle } from 'lucide-react';
import { updateUserRole, disableUser, enableUser } from '@/app/admin/(dashboard)/users/actions';
import { useRouter } from 'next/navigation';

interface UserActionButtonsProps {
  userId: string;
  currentRole: string;
  isDisabled: boolean;
}

export function UserActionButtons({ userId, currentRole, isDisabled }: UserActionButtonsProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [role, setRole] = useState(currentRole);
  const router = useRouter();

  async function handleRoleChange(newRole: string) {
    setIsLoading(true);
    try {
      await updateUserRole(userId, newRole);
      setRole(newRole);
      router.refresh();
    } catch (error) {
      console.error('Failed to update user role:', error);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleToggleStatus() {
    setIsLoading(true);
    try {
      if (isDisabled) {
        await enableUser(userId);
      } else {
        await disableUser(userId);
      }
      router.refresh();
    } catch (error) {
      console.error('Failed to toggle user status:', error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={role} onValueChange={handleRoleChange} disabled={isLoading}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="free">Free</SelectItem>
          <SelectItem value="premium">Premium</SelectItem>
          <SelectItem value="pro">Pro</SelectItem>
          <SelectItem value="admin">Admin</SelectItem>
        </SelectContent>
      </Select>

      <Button
        variant={isDisabled ? 'default' : 'destructive'}
        size="sm"
        onClick={handleToggleStatus}
        disabled={isLoading}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isDisabled ? (
          <>
            <CheckCircle className="h-4 w-4 mr-2" />
            Enable
          </>
        ) : (
          <>
            <Ban className="h-4 w-4 mr-2" />
            Disable
          </>
        )}
      </Button>
    </div>
  );
}
