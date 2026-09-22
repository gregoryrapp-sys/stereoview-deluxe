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
 * So the public gallery is fetched from the function instead of from PostgREST,
 * and the photo URLs come back already signed by the service role. That is also
 * the only way private images can load at all: storage RLS sees nothing but the
 * bearer token, so it could never be persuaded by a grant held anywhere else.
 *
 * Every public-profile page load goes through here - with or without grants -
 * because the function is what can return a private-but-listed row as a locked
 * stub without its bcrypt hash, and an unlisted row only when the URL names it.
 *
 * Tokens live in sessionStorage - an unlock should not outlive the browser
 * session, and they expire server-side after 12 hours regardless.
 */

const GRANT_STORAGE_KEY = 'svd:access-grants:v2';

export type AccessLevel = 'profile' | 'event' | 'album';

export interface LockedInfo {
  level: AccessLevel;
  objectId: string;
  /** Private with no PIN set: a legacy dead-end state. Nothing can unlock it. */
  noPin?: boolean;
}

export interface GalleryResponse extends SharedGalleryData {
  /** True when the caller is signed in as the profile's owner. */
  ownerView: boolean;
  /** Set when the addressed level (or an ancestor) wants a PIN. */
  locked: LockedInfo | null;
  /** Set when the URL names an event/album that does not exist. */
  missing: 'event' | 'album' | null;
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
 * Loads a public profile page through the unlock function.
 *
 * `eventSlug` / `albumSlug` tell the server which rows the URL addresses, so an
 * unlisted event or album is returned when it is the page being opened, and so
 * `locked` / `missing` describe the addressed level rather than the profile.
 *
 * Returns null only when no profile has that slug.
 */
export async function fetchGallery(params: {
  profileSlug: string;
  eventSlug?: string;
  albumSlug?: string;
}): Promise<GalleryResponse | null> {
  const { data, error } = await supabase.functions.invoke('unlock-access', {
    body: { action: 'gallery', ...params, tokens: grants },
  });

  if (error) throw new Error(error.message);
  if (!data?.found) return null;

  return {
    profile: data.profile,
    events: data.events ?? [],
    albums: data.albums ?? [],
    photos: data.photos ?? [],
    ownerView: !!data.ownerView,
    locked: data.locked ?? null,
    missing: data.missing ?? null,
  } as GalleryResponse;
}
