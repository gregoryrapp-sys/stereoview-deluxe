import { supabase } from '@/lib/supabase';
import type { SharedGalleryData } from '@/services/galleryService';

/**
 * PIN unlock grants for private profiles, events and albums.
 *
 * A grant is an opaque token issued by the unlock-access edge function, not a
 * JWT. The original design minted a token carrying an `unlocked_ids` claim for
 * verify_private_access() to read, but this project uses asymmetric JWT signing
 * keys - Supabase holds the private key - so a self-signed token would be
 * rejected by PostgREST and storage alike.
 *
 * So unlocked content is fetched from the function instead of from PostgREST, and
 * the photo URLs come back already signed by the service role. That is also the
 * only way the images can load at all: storage RLS sees nothing but the bearer
 * token, so it could never be persuaded by a grant held anywhere else.
 *
 * Tokens live in sessionStorage - an unlock should not outlive the browser
 * session, and they expire server-side after 12 hours regardless.
 */

const GRANT_STORAGE_KEY = 'svd:access-grants:v2';

export type AccessLevel = 'profile' | 'event' | 'album';

export interface AccessProbe {
  found: boolean;
  requires?: AccessLevel | null;
  objectId?: string;
}

function readStoredGrants(): string[] {
  try {
    const raw = sessionStorage.getItem(GRANT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    // Private browsing, blocked storage, or a corrupt entry.
    return [];
  }
}

let grants: string[] = readStoredGrants();

export function getGrantTokens(): string[] {
  return grants;
}

export function hasAccessGrant(): boolean {
  return grants.length > 0;
}

function persist(): void {
  try {
    if (grants.length) sessionStorage.setItem(GRANT_STORAGE_KEY, JSON.stringify(grants));
    else sessionStorage.removeItem(GRANT_STORAGE_KEY);
  } catch {
    // In-memory grants still work for this page view.
  }
}

/** Grants accumulate: unlocking an album must not drop a previously unlocked event. */
function addGrant(token: string): void {
  if (!grants.includes(token)) {
    grants = [...grants, token];
    persist();
  }
}

export function clearGrants(): void {
  grants = [];
  persist();
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
  // A wrong PIN returns 401, which supabase-js surfaces as an error; anything
  // without a token is a failed unlock.
  if (error || !data?.token) {
    throw new Error('Incorrect PIN.');
  }
  addGrant(data.token as string);
}

/**
 * Loads a gallery through the unlock function, which applies the same visibility
 * cascade as RLS and returns photo URLs already signed.
 *
 * Returns null when the profile is not found or still not visible with the grants
 * currently held.
 */
export async function fetchUnlockedGallery(
  profileSlug: string,
): Promise<SharedGalleryData | null> {
  const { data, error } = await supabase.functions.invoke('unlock-access', {
    body: { action: 'gallery', profileSlug, tokens: grants },
  });

  if (error) throw new Error(error.message);
  if (!data?.found) return null;

  return {
    profile: data.profile,
    events: data.events ?? [],
    albums: data.albums ?? [],
    photos: data.photos ?? [],
  } as SharedGalleryData;
}
