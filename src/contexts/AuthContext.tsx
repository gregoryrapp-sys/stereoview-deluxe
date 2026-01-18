import React, { createContext, useContext, useEffect, useMemo, useState, ReactNode } from 'react';
import { UserAccount } from '@/lib/types';
import { ensureSeedData, getCurrentUserId, getUsers, setCurrentUserId } from '@/lib/storage';

interface AuthContextType {
  isAuthenticated: boolean;
  currentUser: UserAccount | null;
  isAdmin: boolean;
  login: (username: string, password: string) => UserAccount | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(null);

  useEffect(() => {
    ensureSeedData();
    const userId = getCurrentUserId();
    if (userId) {
      const user = getUsers().find((entry) => entry.id === userId) ?? null;
      setCurrentUser(user);
    }
  }, []);

  const login = (username: string, password: string): UserAccount | null => {
    const user = getUsers().find(
      (entry) => entry.username.toLowerCase() === username.toLowerCase() && entry.password === password
    );
    if (user) {
      setCurrentUser(user);
      setCurrentUserId(user.id);
      return user;
    }
    return null;
  };

  const logout = () => {
    setCurrentUser(null);
    setCurrentUserId(null);
  };

  const value = useMemo(
    () => ({
      isAuthenticated: !!currentUser,
      currentUser,
      isAdmin: currentUser?.role === 'admin',
      login,
      logout
    }),
    [currentUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
