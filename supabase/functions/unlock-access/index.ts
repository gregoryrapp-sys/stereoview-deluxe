import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import * as bcrypt from "https://deno.land/x/bcrypt@v0.4.1/mod.ts";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.107.0";
import { corsHeaders } from "../_shared/cors.ts";

/**
 * PIN unlock for private profiles, events and albums.
 *
 * The RLS side of this feature already existed and was correct:
 * verify_private_access() (20260623000000) reads an `unlocked_ids` claim from the
 * caller's JWT. What never existed was anything that mints that claim, or any UI
 * to enter a PIN - so setting a PIN made content permanently unreachable. This
 * function is the missing half.
 *
 * Why a JWT rather than a grant token in a header: storage.objects RLS is
 * evaluated by the storage service, which only ever sees the bearer token. A
 * custom header would unlock the database rows and then fail to sign a single
 * photo URL. Putting the grant in the token makes PostgREST and Storage agree.
 *
 * The minted token deliberately mirrors the shape of the project's own anon key -
 * same role, same issuer - plus the unlocked_ids claim. It grants nothing beyond
 * anonymous access to the specific object ids whose PIN was just verified.
 */

type ObjectType = "profile" | "event" | "album";

const TABLES: Record<ObjectType, string> = {
  profile: "profiles",
  event: "events",
  album: "albums",
};

/** Unlocks are short-lived; the visitor re-enters the PIN in a new session. */
const GRANT_TTL_SECONDS = 12 * 60 * 60;

/** Per-isolate throttle. Not a substitute for a real limiter, but it makes a
 *  4-digit PIN impractical to grind through a single warm instance. */
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

async function signingKey(): Promise<CryptoKey> {
  return await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(requireEnv("SUPABASE_JWT_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Existing grants ride along, so unlocking an album does not drop a previously
 *  unlocked event. Read without verifying: these ids only widen access after the
 *  signature is re-checked by Postgres, and an id the caller was not entitled to
 *  simply fails RLS there. */
function existingGrants(token: string | undefined): string[] {
  if (!token) return [];
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return Array.isArray(payload?.unlocked_ids) ? payload.unlocked_ids.map(String) : [];
  } catch {
    return [];
  }
}

const admin = () =>
  createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });

/**
 * Reports which level of a gallery URL is PIN-protected, so the page can show a
 * prompt instead of "not found". Never returns the hash, and reports only
 * whether a PIN exists - which the visitor is about to be asked for anyway.
 */
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
  if (event.password) {
    return json({ found: true, requires: "event", objectId: event.id }, 200);
  }

  if (!albumSlug) return json({ found: true, requires: null }, 200);

  const { data: album } = await db
    .from("albums")
    .select("id, password")
    .eq("event_id", event.id)
    .eq("slug", albumSlug)
    .maybeSingle();

  if (!album) return json({ found: false }, 200);
  if (album.password) {
    return json({ found: true, requires: "album", objectId: album.id }, 200);
  }

  return json({ found: true, requires: null }, 200);
}

async function unlock(body: Record<string, string | undefined>, authHeader: string) {
  const { objectType, objectId, pin } = body;

  if (!objectType || !objectId || !pin) {
    return json({ error: "objectType, objectId and pin are required" }, 400);
  }
  if (!(objectType in TABLES)) {
    return json({ error: "Unknown objectType" }, 400);
  }
  if (rateLimited(`${objectType}:${objectId}`)) {
    return json({ error: "Too many attempts. Try again later." }, 429);
  }

  const { data: row } = await admin()
    .from(TABLES[objectType as ObjectType])
    .select("id, password")
    .eq("id", objectId)
    .maybeSingle();

  // Same response whether the row is missing or the PIN is wrong, so this cannot
  // be used to enumerate ids.
  if (!row?.password || !(await bcrypt.compare(pin, row.password))) {
    return json({ error: "Incorrect PIN." }, 401);
  }

  const granted = Array.from(
    new Set([...existingGrants(authHeader.replace(/^Bearer\s+/i, "")), String(row.id)]),
  );

  const token = await create(
    { alg: "HS256", typ: "JWT" },
    {
      role: "anon",
      iss: "supabase",
      iat: getNumericDate(0),
      exp: getNumericDate(GRANT_TTL_SECONDS),
      unlocked_ids: granted,
    },
    await signingKey(),
  );

  return json({ token, expiresIn: GRANT_TTL_SECONDS, unlockedIds: granted }, 200);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body?.action;

    if (action === "probe") return await probe(body);
    if (action === "unlock") return await unlock(body, req.headers.get("Authorization") ?? "");

    return json({ error: 'Invalid action. Use "probe" or "unlock".' }, 400);
  } catch (err) {
    console.error("unlock-access failed:", err instanceof Error ? err.message : err);
    return json({ error: "Unlock failed." }, 500);
  }
});
