'use client';

import { createContext, useContext } from 'react';
import { User } from '@/types/db';

interface UserContextType {
  user: User | null;
}

const UserContext = createContext<UserContextType>({ user: null });

export function UserProvider({
  children,
  user,
}: {
  children: React.ReactNode;
  user: User | null;
}) {
  return (
    <UserContext.Provider value={{ user }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context.user;
}
