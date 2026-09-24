import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// Only the *Sync* helpers are usable here: bcrypt's async hash/compare spawn a
// Web Worker, which the Supabase edge runtime does not provide, so they throw
// "Worker is not defined" at runtime.
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabaseAdmin.ts";

/**
 * PIN unlock and public-gallery serving for profiles, events and albums.
 *
 * Setting a PIN used to make content permanently unreachable. The RLS half
 * existed - verify_private_access() reads an `unlocked_ids` JWT claim - but
 * nothing ever minted that claim and there was no UI to enter a PIN.
 *
 * Minting the claim ourselves is not possible on this project: it uses asymmetric
 * JWT signing keys, so Supabase holds the private key and a self-signed token
 * would be rejected. So instead of granting the caller rights and letting RLS
 * serve them, this function verifies the PIN and then serves the gallery itself
 * with the service role - including signing the photo URLs, which is the part no
 * header- or cookie-based scheme could do, because storage RLS only ever sees
 * the bearer token.
 *
 * Every public profile page load goes through `gallery`, grants or not. Two
 * things need the service role even for a visitor with no PIN:
 *
 *   - a private-but-LISTED row is returned as a locked stub (title, slug, no
 *     hash) so the page can show a card with a lock;
 *   - an UNLISTED row is returned only when the URL names it.
 *
 * Neither can be expressed in RLS, which is row-level and intent-blind.
 *
 * The consequence is deliberate and worth stating plainly: the visibility rules
 * in `gallery` ARE the access control for this page. They mirror the SELECT
 * policies in 20260921002000_listing_pin_and_directory.sql, including the
 * cascade where unlocking a parent reaches children that have no PIN of their
 * own. If those policies change, this must change with them - and so must
 * can_read_storage_object (20260624000000).
 */

type ObjectType = "profile" | "event" | "album";

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

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

// Service-role client; credential resolution (and why the bare
// SUPABASE_SERVICE_ROLE_KEY is preferred) is documented in _shared/supabaseAdmin.ts.
const admin = adminClient;

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

/**
 * Identifies a signed-in caller, if any.
 *
 * supabase-js sends the session access token when there is one and the
 * publishable key otherwise. `sb_publishable_...` is not a JWT, so only a real
 * session token is handed to the Auth server for verification.
 */
async function callerUserId(
  db: ReturnType<typeof admin>,
  authHeader: string | null,
): Promise<string | null> {
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!token || !token.startsWith("eyJ")) return null;
  const { data, error } = await db.auth.getUser(token);
  if (error) return null;
  return data.user?.id ?? null;
}

/**
 * Removes the bcrypt hash - and the email, for profiles - before a row leaves
 * the server. A 4-6 digit PIN hash is brute-forced offline in minutes, so this
 * applies to EVERY row, including ones the caller has just unlocked.
 */
function strip(row: Row): Row {
  const { password: _password, email: _email, ...rest } = row;
  return rest;
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
  if (!profile.is_public && profile.password) {
    return json({ found: true, requires: "profile", objectId: profile.id }, 200);
  }

  if (!eventSlug) return json({ found: true, requires: null }, 200);

  const { data: event } = await db
    .from("events")
    .select("id, is_public, password")
    .eq("owner_id", profile.id)
    .eq("slug", eventSlug)
    .maybeSingle();

  if (!event) return json({ found: false }, 200);
  if (!event.is_public && event.password) {
    return json({ found: true, requires: "event", objectId: event.id }, 200);
  }

  if (!albumSlug) return json({ found: true, requires: null }, 200);

  const { data: album } = await db
    .from("albums")
    .select("id, is_public, password")
    .eq("event_id", event.id)
    .eq("slug", albumSlug)
    .maybeSingle();

  if (!album) return json({ found: false }, 200);
  if (!album.is_public && album.password) {
    return json({ found: true, requires: "album", objectId: album.id }, 200);
  }

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

  // The client just saw this id in a locked stub, so failing to read it back
  // here almost always means the client is not actually service-role and RLS is
  // hiding the row. Logged loudly because the visitor-facing symptom -
  // "Incorrect PIN" for a correct PIN - gives no hint of the real cause.
  if (!row) {
    console.error(
      `unlock: ${objectType} ${objectId} not readable. Check the service-role credential.`,
    );
  }

  // Identical response for a missing row and a wrong PIN, so this cannot be used
  // to enumerate ids.
  if (!row?.password || !bcrypt.compareSync(pin, row.password)) {
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
 * Serves a public profile page.
 *
 * For each level the row is UNLOCKED if it is public, directly granted, PIN-less
 * under a granted ancestor, or the caller owns it. A row is INCLUDED when:
 *
 *   unlocked  and (listed or addressed by the URL or owner view)  -> full row
 *   locked    and (listed or addressed by the URL)                -> stub
 *   otherwise                                                     -> omitted
 *
 * Children of a locked row are never returned. Photos are returned only for
 * unlocked albums. `locked` names the first locked level the URL addresses;
 * `missing` names an addressed level that does not exist.
 */
async function gallery(
  body: {
    profileSlug?: string;
    eventSlug?: string;
    albumSlug?: string;
    tokens?: string[];
    /** Owner asks to see the page exactly as a visitor would: no owner view. */
    asVisitor?: boolean;
  },
  authHeader: string | null,
) {
  const { profileSlug, eventSlug, albumSlug, tokens = [], asVisitor = false } = body;
  if (!profileSlug) return json({ error: "profileSlug is required" }, 400);

  const db = admin();
  const [granted, userId] = await Promise.all([
    resolveGrants(db, tokens),
    // A signed-in owner sees their own private rows by default, which reads as
    // "the PIN did not work" when they test their own link. `asVisitor` drops
    // the session so the page renders with the visitor cascade only.
    asVisitor ? Promise.resolve(null) : callerUserId(db, authHeader),
  ]);

  const { data: profile } = await db
    .from("profiles")
    .select("*")
    .eq("slug", profileSlug)
    .maybeSingle();

  if (!profile) return json({ found: false }, 200);

  const ownerView = !!userId && userId === profile.id;
  const profileGranted = granted.has(String(profile.id));
  const profileUnlocked = profile.is_public || profileGranted || ownerView;

  if (!profileUnlocked) {
    return json({
      found: true,
      ownerView,
      profile: {
        id: profile.id,
        slug: profile.slug,
        display_name: profile.display_name,
        created_at: profile.created_at,
        is_public: false,
        is_listed: profile.is_listed ?? true,
        locked: true,
      },
      events: [],
      albums: [],
      photos: [],
      locked: { level: "profile", objectId: profile.id, noPin: !profile.password },
      missing: null,
    }, 200);
  }

  const { data: allEvents } = await db
    .from("events")
    .select("*")
    .eq("owner_id", profile.id)
    .order("created_at", { ascending: false });

  const eventUnlocked = (event: Row) =>
    event.is_public ||
    granted.has(String(event.id)) ||
    (!event.password && profileGranted) ||
    ownerView;

  const events: Row[] = [];
  const unlockedEvents = new Map<string, Row>();

  for (const event of allEvents ?? []) {
    const unlocked = eventUnlocked(event);
    const addressed = !!eventSlug && event.slug === eventSlug;
    const listed = event.is_listed ?? true;

    if (unlocked && (listed || addressed || ownerView)) {
      events.push(strip(event));
      unlockedEvents.set(String(event.id), event);
    } else if (!unlocked && (listed || addressed)) {
      events.push({
        id: event.id,
        owner_id: event.owner_id,
        slug: event.slug,
        title: event.title,
        created_at: event.created_at,
        is_public: false,
        is_listed: listed,
        locked: true,
      });
    }
  }

  const { data: allAlbums } = unlockedEvents.size
    ? await db
        .from("albums")
        .select("*")
        .in("event_id", [...unlockedEvents.keys()])
        .order("created_at", { ascending: false })
    : { data: [] as Row[] };

  const albumUnlocked = (album: Row, parent: Row) =>
    album.is_public ||
    granted.has(String(album.id)) ||
    ownerView ||
    (!album.password &&
      (granted.has(String(parent.id)) || (!parent.password && profileGranted)));

  const albums: Row[] = [];
  const unlockedAlbumIds = new Set<string>();

  for (const album of allAlbums ?? []) {
    const parent = unlockedEvents.get(String(album.event_id));
    if (!parent) continue;

    const unlocked = albumUnlocked(album, parent);
    const addressed = !!albumSlug && parent.slug === eventSlug && album.slug === albumSlug;
    const listed = album.is_listed ?? true;

    if (unlocked && (listed || addressed || ownerView)) {
      albums.push(strip(album));
      unlockedAlbumIds.add(String(album.id));
    } else if (!unlocked && (listed || addressed)) {
      albums.push({
        id: album.id,
        event_id: album.event_id,
        slug: album.slug,
        title: album.title,
        created_at: album.created_at,
        source_type: album.source_type,
        is_public: false,
        is_listed: listed,
        locked: true,
      });
    }
  }

  // Soft-deleted rows (a Dropbox sync found the file gone) are invisible here,
  // exactly as in fetchGalleryData; their objects stay for Restore.
  const { data: photoRows } = unlockedAlbumIds.size
    ? await db
        .from("photos")
        .select("*")
        .in("album_id", [...unlockedAlbumIds])
        .is("deleted_at", null)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
    : { data: [] as Row[] };

  // Originals and thumbnails signed in the same batches; a thumbnail that fails
  // to sign only costs the fallback to the original.
  const paths = (photoRows ?? []).flatMap((photo) =>
    photo.thumb_path
      ? [photo.storage_path as string, photo.thumb_path as string]
      : [photo.storage_path as string],
  );
  const signed = new Map<string, string>();

  for (let offset = 0; offset < paths.length; offset += 500) {
    const { data: urls } = await db.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrls(paths.slice(offset, offset + 500), GRANTED_URL_TTL_SECONDS);
    for (const item of urls ?? []) {
      if (item.path && item.signedUrl) signed.set(item.path, item.signedUrl);
    }
  }

  const albumEventIds = new Map(
    (allAlbums ?? []).map((album) => [String(album.id), album.event_id]),
  );

  const photos = (photoRows ?? []).flatMap((photo) => {
    const src = signed.get(photo.storage_path);
    if (!src) return [];
    return [{
      id: photo.id,
      src,
      alt: photo.alt,
      albumId: photo.album_id,
      eventId: albumEventIds.get(String(photo.album_id)),
      storagePath: photo.storage_path,
      thumbPath: photo.thumb_path ?? undefined,
      thumbSrc: photo.thumb_path ? signed.get(photo.thumb_path) : undefined,
      // Raw alignment columns; the client resolves them against the album's
      // lr_swapped_default with the same helper the PostgREST path uses.
      alignDx: photo.align_dx ?? null,
      alignDy: photo.align_dy ?? null,
      lrSwapped: photo.lr_swapped ?? null,
      alignVersion: photo.align_version ?? null,
      alignConfidence: photo.align_confidence ?? null,
      created_at: photo.file_modified_at ?? photo.created_at,
      extension: (/\.([a-zA-Z0-9]+)$/.exec(photo.storage_path)?.[1] ?? "").toLowerCase(),
    }];
  });

  // What the URL points at, so the client can show the right prompt.
  let locked: { level: ObjectType; objectId: string; noPin: boolean } | null = null;
  let missing: "event" | "album" | null = null;

  if (eventSlug) {
    const target = (allEvents ?? []).find((event) => event.slug === eventSlug);
    if (!target) {
      missing = "event";
    } else if (!unlockedEvents.has(String(target.id))) {
      locked = { level: "event", objectId: target.id, noPin: !target.password };
    } else if (albumSlug) {
      const targetAlbum = (allAlbums ?? []).find(
        (album) => String(album.event_id) === String(target.id) && album.slug === albumSlug,
      );
      if (!targetAlbum) {
        missing = "album";
      } else if (!unlockedAlbumIds.has(String(targetAlbum.id))) {
        locked = { level: "album", objectId: targetAlbum.id, noPin: !targetAlbum.password };
      }
    }
  }

  return json({
    found: true,
    ownerView,
    profile: strip(profile),
    events,
    albums,
    photos,
    locked,
    missing,
  }, 200);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json();

    if (body?.action === "probe") return await probe(body);
    if (body?.action === "unlock") return await unlock(body);
    if (body?.action === "gallery") return await gallery(body, req.headers.get("Authorization"));

    return json({ error: 'Invalid action. Use "probe", "unlock" or "gallery".' }, 400);
  } catch (err) {
    console.error("unlock-access failed:", err instanceof Error ? err.message : err);
    return json({ error: "Request failed." }, 500);
  }
});
