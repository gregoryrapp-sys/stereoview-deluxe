import React, { createContext, useContext, useMemo, useState, ReactNode } from 'react';

type UserRole = 'admin' | 'user';

interface AuthContextType {
  isAuthenticated: boolean;
  role: UserRole | null;
  username: string | null;
  login: (username: string, password: string) => UserRole | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const USERS: Record<string, { password: string; role: UserRole }> = {
  admin: { password: '88888888', role: 'admin' },
  user: { password: '88888888', role: 'user' }
};

const AUTH_KEY = 'gregsPhotosAuth';
const AUTH_ROLE_KEY = 'gregsPhotosAuthRole';
const AUTH_USERNAME_KEY = 'gregsPhotosAuthUsername';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return localStorage.getItem(AUTH_KEY) === 'true';
  });
  const [role, setRole] = useState<UserRole | null>(() => {
    return (localStorage.getItem(AUTH_ROLE_KEY) as UserRole | null) ?? null;
  });
  const [username, setUsername] = useState<string | null>(() => {
    return localStorage.getItem(AUTH_USERNAME_KEY);
  });

  const login = (loginUsername: string, password: string): UserRole | null => {
    const record = USERS[loginUsername];
    if (record && record.password === password) {
      setIsAuthenticated(true);
      setRole(record.role);
      setUsername(loginUsername);
      localStorage.setItem(AUTH_KEY, 'true');
      localStorage.setItem(AUTH_ROLE_KEY, record.role);
      localStorage.setItem(AUTH_USERNAME_KEY, loginUsername);
      return record.role;
    }
    return null;
  };

  const logout = () => {
    setIsAuthenticated(false);
    setRole(null);
    setUsername(null);
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(AUTH_ROLE_KEY);
    localStorage.removeItem(AUTH_USERNAME_KEY);
  };

  const value = useMemo(
    () => ({ isAuthenticated, role, username, login, logout }),
    [isAuthenticated, role, username]
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
