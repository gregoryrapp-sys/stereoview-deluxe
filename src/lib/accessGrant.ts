import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database';

/**
 * Holds a PIN unlock grant and hands out a Supabase client that carries it.
 *
 * The grant has to travel as the bearer token rather than a custom header:
 * storage.objects RLS is evaluated by the storage service, which only ever sees
 * the token. A header-based grant would unlock the database rows and then fail to
 * sign a single photo URL - the unlocked album would render as a grid of broken
 * images.
 *
 * Kept in sessionStorage, not localStorage: an unlock should not outlive the
 * browser session, and the token is short-lived server-side regardless.
 */

const GRANT_STORAGE_KEY = 'svd:access-grant:v1';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

let grantToken: string | null = readStoredGrant();
const listeners = new Set<() => void>();

function readStoredGrant(): string | null {
  try {
    return sessionStorage.getItem(GRANT_STORAGE_KEY);
  } catch {
    // Private browsing or blocked storage; the grant simply does not persist.
    return null;
  }
}

export function getGrantToken(): string | null {
  return grantToken;
}

export function hasAccessGrant(): boolean {
  return grantToken !== null;
}

export function setGrantToken(token: string | null): void {
  grantToken = token;
  try {
    if (token) sessionStorage.setItem(GRANT_STORAGE_KEY, token);
    else sessionStorage.removeItem(GRANT_STORAGE_KEY);
  } catch {
    // In-memory grant still works for this page view.
  }
  listeners.forEach((listener) => listener());
}

export function onGrantChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A second client whose bearer token is resolved per request.
 *
 * Supplying `accessToken` disables this client's own auth methods, which is why
 * it is separate from the main one rather than replacing it - AuthContext still
 * needs supabase.auth for photographer login. The fallback chain matters: an
 * owner previewing their own public page must keep their session privileges
 * rather than being downgraded to anonymous.
 */
export const grantedSupabase: SupabaseClient<Database> = createClient<Database>(
  supabaseUrl,
  supabaseKey,
  {
    auth: { persistSession: false, autoRefreshToken: false },
    accessToken: async () => {
      if (grantToken) return grantToken;
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? supabaseKey;
    },
  },
);

/** Use the grant-scoped client only when a grant is actually held. */
export function readClient(): SupabaseClient<Database> {
  return grantToken ? grantedSupabase : supabase;
}

export type AccessLevel = 'profile' | 'event' | 'album';

export interface AccessProbe {
  found: boolean;
  requires?: AccessLevel | null;
  objectId?: string;
}

export async function probeAccess(params: {
  profileSlug: string;
  eventSlug?: string;
  albumSlug?: string;
}): Promise<AccessProbe> {
  const { data, error } = await supabase.functions.invoke('unlock-access', {
    body: { action: 'probe', ...params },
  });
  if (error) throw new Error(error.message);
  return data as AccessProbe;
}

export async function unlockWithPin(params: {
  objectType: AccessLevel;
  objectId: string;
  pin: string;
}): Promise<void> {
  const { data, error } = await supabase.functions.invoke('unlock-access', {
    body: { action: 'unlock', ...params },
  });
  // The function returns 401 for a wrong PIN, which supabase-js surfaces as an
  // error; treat anything without a token as a failed unlock.
  if (error || !data?.token) {
    throw new Error('Incorrect PIN.');
  }
  setGrantToken(data.token as string);
}
