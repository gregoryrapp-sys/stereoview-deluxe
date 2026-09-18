import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.107.0";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * PIN unlock for private profiles, events and albums.
 *
 * Setting a PIN used to make content permanently unreachable. The RLS half
 * existed - verify_private_access() reads an `unlocked_ids` JWT claim - but
 * nothing ever minted that claim and there was no UI to enter a PIN.
 *
 * Minting the claim ourselves is not possible on this project: it uses asymmetric
 * JWT signing keys, so Supabase holds the private key and a self-signed token
 * would be rejected. So instead of granting the caller rights and letting RLS
 * serve them, this function verifies the PIN and then serves the unlocked gallery
 * itself with the service role - including signing the photo URLs, which is the
 * part no header- or cookie-based scheme could do, because storage RLS only ever
 * sees the bearer token.
 *
 * The consequence is deliberate and worth stating plainly: for unlocked content,
 * the visibility rules below ARE the access control. They mirror the RLS policies
 * in 20260624000000_update_rls_for_public_access.sql, including the cascade where
 * unlocking a parent reaches children that have no PIN of their own. If those
 * policies change, this must change with them.
 */

type ObjectType = "profile" | "event" | "album";

const TABLES: Record<ObjectType, string> = {
  profile: "profiles",
  event: "events",
  album: "albums",
};

const GRANT_TTL_SECONDS = 12 * 60 * 60;

/** Granted photo URLs are deliberately shorter-lived than public ones: a signed
 *  URL works for anyone holding it, so private content should not hand out a
 *  week-long link. */
const GRANTED_URL_TTL_SECONDS = GRANT_TTL_SECONDS;

const PHOTOS_BUCKET = "photos";

const MAX_ATTEMPTS_PER_WINDOW = 10;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + ATTEMPT_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS_PER_WINDOW;
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function admin() {
  // SUPABASE_SERVICE_ROLE_KEY is marked deprecated in favour of SUPABASE_SECRET_KEYS,
  // but is still injected and still works. Prefer the new one when present.
  const secret = Deno.env.get("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret) throw new Error("No service credential available");

  // SUPABASE_SECRET_KEYS is a JSON dictionary; the legacy variable is a bare key.
  let key = secret;
  if (secret.trim().startsWith("{")) {
    const parsed = JSON.parse(secret) as Record<string, string>;
    key = Object.values(parsed)[0];
  }

  return createClient(requireEnv("SUPABASE_URL"), key, { auth: { persistSession: false } });
}

function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Resolves grant tokens to the object ids they unlock, dropping anything expired. */
async function resolveGrants(
  db: ReturnType<typeof admin>,
  tokens: string[],
): Promise<Set<string>> {
  if (tokens.length === 0) return new Set();

  const { data } = await db
    .from("access_grants")
    .select("object_id, expires_at")
    .in("token", tokens.slice(0, 20));

  const now = Date.now();
  return new Set(
    (data ?? [])
      .filter((row) => new Date(row.expires_at).getTime() > now)
      .map((row) => String(row.object_id)),
  );
}

async function probe(body: Record<string, string | undefined>) {
  const { profileSlug, eventSlug, albumSlug } = body;
  if (!profileSlug) return json({ error: "profileSlug is required" }, 400);

  const db = admin();

  const { data: profile } = await db
    .from("profiles")
    .select("id, is_public, password")
    .eq("slug", profileSlug)
    .maybeSingle();

  if (!profile) return json({ found: false }, 200);
  if (profile.password) {
    return json({ found: true, requires: "profile", objectId: profile.id }, 200);
  }

  if (!eventSlug) return json({ found: true, requires: null }, 200);

  const { data: event } = await db
    .from("events")
    .select("id, password")
    .eq("owner_id", profile.id)
    .eq("slug", eventSlug)
    .maybeSingle();

  if (!event) return json({ found: false }, 200);
  if (event.password) return json({ found: true, requires: "event", objectId: event.id }, 200);

  if (!albumSlug) return json({ found: true, requires: null }, 200);

  const { data: album } = await db
    .from("albums")
    .select("id, password")
    .eq("event_id", event.id)
    .eq("slug", albumSlug)
    .maybeSingle();

  if (!album) return json({ found: false }, 200);
  if (album.password) return json({ found: true, requires: "album", objectId: album.id }, 200);

  return json({ found: true, requires: null }, 200);
}

async function unlock(body: Record<string, string | undefined>) {
  const { objectType, objectId, pin } = body;

  if (!objectType || !objectId || !pin) {
    return json({ error: "objectType, objectId and pin are required" }, 400);
  }
  if (!(objectType in TABLES)) return json({ error: "Unknown objectType" }, 400);
  if (rateLimited(`${objectType}:${objectId}`)) {
    return json({ error: "Too many attempts. Try again later." }, 429);
  }

  const db = admin();

  const { data: row } = await db
    .from(TABLES[objectType as ObjectType])
    .select("id, password")
    .eq("id", objectId)
    .maybeSingle();

  // Identical response for a missing row and a wrong PIN, so this cannot be used
  // to enumerate ids.
  if (!row?.password || !(await bcrypt.compare(pin, row.password))) {
    return json({ error: "Incorrect PIN." }, 401);
  }

  const token = newToken();
  const expiresAt = new Date(Date.now() + GRANT_TTL_SECONDS * 1000).toISOString();

  const { error } = await db.from("access_grants").insert({
    token,
    object_type: objectType,
    object_id: row.id,
    expires_at: expiresAt,
  });
  if (error) throw error;

  // Opportunistic cleanup, so the table does not grow without bound.
  await db.from("access_grants").delete().lt("expires_at", new Date().toISOString());

  return json({ token, expiresIn: GRANT_TTL_SECONDS }, 200);
}

/**
 * Serves the gallery a set of grants unlocks.
 *
 * Mirrors the RLS cascade: a row is visible if it is public, or directly granted,
 * or its own PIN is unset and an ancestor was granted.
 */
async function gallery(body: { profileSlug?: string; tokens?: string[] }) {
  const { profileSlug, tokens = [] } = body;
  if (!profileSlug) return json({ error: "profileSlug is required" }, 400);

  const db = admin();
  const granted = await resolveGrants(db, tokens);

  const { data: profile } = await db
    .from("profiles")
    .select("*")
    .eq("slug", profileSlug)
    .maybeSingle();

  if (!profile) return json({ found: false }, 200);

  const profileGranted = granted.has(String(profile.id));
  if (!profile.is_public && !profileGranted) return json({ found: false }, 200);

  const { data: allEvents } = await db
    .from("events")
    .select("*")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false });

  const events = (allEvents ?? []).filter(
    (event) =>
      event.is_public ||
      granted.has(String(event.id)) ||
      (!event.password && profileGranted),
  );

  const eventById = new Map(events.map((event) => [event.id, event]));

  const { data: allAlbums } = events.length
    ? await db
        .from("albums")
        .select("*")
        .in("event_id", events.map((event) => event.id))
        .order("created_at", { ascending: false })
    : { data: [] };

  const albums = (allAlbums ?? []).filter((album) => {
    const parent = eventById.get(album.event_id);
    if (!parent) return false;
    if (album.is_public || granted.has(String(album.id))) return true;
    if (album.password) return false;
    if (granted.has(String(parent.id))) return true;
    return !parent.password && profileGranted;
  });

  const { data: photoRows } = albums.length
    ? await db
        .from("photos")
        .select("*")
        .in("album_id", albums.map((album) => album.id))
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
    : { data: [] };

  const paths = (photoRows ?? []).map((photo) => photo.storage_path);
  const signed = new Map<string, string>();

  for (let offset = 0; offset < paths.length; offset += 500) {
    const { data: urls } = await db.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrls(paths.slice(offset, offset + 500), GRANTED_URL_TTL_SECONDS);
    for (const item of urls ?? []) {
      if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
    }
  }

  const albumEventIds = new Map(albums.map((album) => [album.id, album.event_id]));

  const photos = (photoRows ?? []).flatMap((photo) => {
    const src = signed.get(photo.storage_path);
    if (!src) return [];
    return [{
      id: photo.id,
      src,
      alt: photo.alt,
      albumId: photo.album_id,
      eventId: albumEventIds.get(photo.album_id),
      storagePath: photo.storage_path,
      created_at: photo.file_modified_at ?? photo.created_at,
      extension: (/\.([a-zA-Z0-9]+)$/.exec(photo.storage_path)?.[1] ?? "").toLowerCase(),
    }];
  });

  // The password hash must never leave the server.
  const { password: _password, email: _email, ...publicProfile } = profile;

  return json({ found: true, profile: publicProfile, events, albums, photos }, 200);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json();

    if (body?.action === "probe") return await probe(body);
    if (body?.action === "unlock") return await unlock(body);
    if (body?.action === "gallery") return await gallery(body);

    return json({ error: 'Invalid action. Use "probe", "unlock" or "gallery".' }, 400);
  } catch (err) {
    console.error("unlock-access failed:", err instanceof Error ? err.message : err);
    return json({ error: "Request failed." }, 500);
  }
});
