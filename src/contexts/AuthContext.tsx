import React, { createContext, useContext, useMemo, useState, ReactNode } from 'react';

export type UserRole = 'admin' | 'user';

export interface UserAccount {
  username: string;
  password: string;
  role: UserRole;
}

interface AuthContextType {
  currentUser: UserAccount | null;
  users: UserAccount[];
  login: (username: string, password: string) => UserAccount | null;
  logout: () => void;
  addUser: (user: UserAccount) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const STORAGE_KEY_USERS = 'stereoViewerUsers';
const STORAGE_KEY_SESSION = 'stereoViewerSession';

const defaultUsers: UserAccount[] = [
  { username: 'admin', password: 'admin123', role: 'admin' },
  { username: 'viewer', password: 'viewer123', role: 'user' },
];

const readStoredUsers = (): UserAccount[] => {
  const storedUsers = localStorage.getItem(STORAGE_KEY_USERS);
  if (!storedUsers) {
    return defaultUsers;
  }
  try {
    return JSON.parse(storedUsers) as UserAccount[];
  } catch {
    return defaultUsers;
  }
};

const readStoredSession = (users: UserAccount[]): UserAccount | null => {
  const storedSession = localStorage.getItem(STORAGE_KEY_SESSION);
  if (!storedSession) {
    return null;
  }
  try {
    const { username } = JSON.parse(storedSession) as { username: string };
    return users.find((user) => user.username === username) ?? null;
  } catch {
    return null;
  }
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<UserAccount[]>(() => readStoredUsers());
  const [currentUser, setCurrentUser] = useState<UserAccount | null>(() =>
    readStoredSession(readStoredUsers())
  );

  const persistUsers = (nextUsers: UserAccount[]) => {
    localStorage.setItem(STORAGE_KEY_USERS, JSON.stringify(nextUsers));
  };

  const login = (username: string, password: string): UserAccount | null => {
    const matchedUser = users.find(
      (user) => user.username === username && user.password === password
    );
    if (matchedUser) {
      setCurrentUser(matchedUser);
      localStorage.setItem(
        STORAGE_KEY_SESSION,
        JSON.stringify({ username: matchedUser.username })
      );
      return matchedUser;
    }
    return null;
  };

  const logout = () => {
    setCurrentUser(null);
    localStorage.removeItem(STORAGE_KEY_SESSION);
  };

  const addUser = (user: UserAccount): boolean => {
    if (users.some((existing) => existing.username === user.username)) {
      return false;
    }
    const nextUsers = [...users, user];
    setUsers(nextUsers);
    persistUsers(nextUsers);
    return true;
  };

  const value = useMemo(
    () => ({
      currentUser,
      users,
      login,
      logout,
      addUser,
    }),
    [currentUser, users]
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
