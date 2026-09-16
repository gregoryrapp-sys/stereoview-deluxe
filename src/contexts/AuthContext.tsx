import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<{ error?: string }>;
  logout: () => Promise<void>;
  /** Re-reads the signed-in user's profile row, e.g. after saving profile settings. */
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Tracked so refreshProfile() can re-read without taking the user as an
  // argument, and without depending on `session` having settled in state yet.
  const userIdRef = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    userIdRef.current = userId;

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.error('Failed to load Supabase profile', error);
      setProfile(null);
      return;
    }

    setProfile(data);
  }, []);

  /**
   * EventAlbumManagement has always destructured this from useAuth(), but the
   * context never provided it - so it was permanently undefined and the guarded
   * call site silently did nothing. After saving profile settings the header and
   * cover kept showing the old values until a full reload.
   */
  const refreshProfile = useCallback(async () => {
    const userId = userIdRef.current;
    if (!userId) return;
    await loadProfile(userId);
  }, [loadProfile]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;

      setSession(data.session);
      if (data.session?.user) {
        await loadProfile(data.session.user.id);
      } else {
        setProfile(null);
      }
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setProfile(null);

      if (nextSession?.user) {
        loadProfile(nextSession.user.id);
      } else {
        userIdRef.current = null;
      }

      setIsLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
    // loadProfile is useCallback([]) and therefore stable, so this still runs once.
  }, [loadProfile]);

  const login = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    return error ? { error: error.message } : {};
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    userIdRef.current = null;
  };

  const user = session?.user ?? null;
  const isAuthenticated = !!user;
  const isAdmin = profile?.role === 'admin';

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        profile,
        isAuthenticated,
        isAdmin,
        isLoading,
        login,
        logout,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
