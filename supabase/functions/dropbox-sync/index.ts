import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { type AdminClient, adminClient, userClient } from "../_shared/supabaseAdmin.ts";
import { type DropboxEntry, isSharedLinkGone, listSharedFolder } from "../_shared/dropbox.ts";
import {
  computeSyncPlan,
  DEFAULT_SYNC_OPTIONS,
  type DbPhotoRow,
  type DropboxFileMeta,
  type Listing,
  type PlannedAddition,
  type SyncPlan,
} from "../_shared/syncPlan.ts";

/**
 * Dropbox import and re-sync for an album.
 *
 *   validate  census of the source folder and of Storage usage; no writes
 *   plan      diff Dropbox against the stored rows and persist the result as a
 *             sync_runs row the owner will approve in the preview
 *   apply     execute the persisted plan in resumable chunks (next release)
 *   status    the active and latest runs for an album
 *   cancel    abandon an active run
 *
 * Authorization pattern - new to this codebase and worth stating: the caller's
 * own JWT is used to read the album THROUGH RLS first. A miss is a 404. Only
 * after ownership is proven that way is the service-role client constructed,
 * and every storage path it writes is asserted to begin with the proven owner
 * id, because the service role bypasses the storage policy that otherwise
 * prevents cross-tenant writes.
 *
 * The diff itself lives in _shared/syncPlan.ts and is pure; every deletion
 * guardrail is there and unit-tested. This file only feeds it complete-or-
 * flagged listings and stores what it returns.
 */

// Supabase Free plan. Refuse to start an import that would land above 90%.
const QUOTA_BYTES = 1024 * 1024 * 1024;
const QUOTA_REFUSE_RATIO = 0.9;
/** Rough per-photo allowance for the thumbnail written beside each import. */
const THUMB_BYTES_ESTIMATE = 90_000;
/** A persisted plan is stale after this; the preview re-plans. */
const PLAN_TTL_MS = 60 * 60 * 1000;
const DB_PAGE_SIZE = 1000;
const ACTIVE_STATUSES = ["planned", "applying", "verifying"];

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra: Row = {}) {
    super(message);
  }
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface AlbumContext {
  albumId: string;
  title: string;
  eventId: string;
  ownerId: string;
  folderUrl: string;
  importState: string;
  lastSyncedAt: string | null;
  coverImageName: string | null;
}

/**
 * Proves the caller may manage this album by reading it with THEIR credentials.
 * Owners and admins pass (`can_access_event` in the albums policy); anyone else
 * sees no row and gets a 404 indistinguishable from a nonexistent album.
 */
async function authorizeAlbum(req: Request, albumId: string | undefined): Promise<AlbumContext> {
  if (!albumId) throw new HttpError(400, "albumId is required");

  const caller = userClient(req.headers.get("Authorization"));
  const { data: auth, error: authError } = await caller.auth.getUser();
  if (authError || !auth.user) throw new HttpError(401, "Authentication required.");

  const { data: album } = await caller
    .from("albums")
    .select(
      "id, title, event_id, source_type, dropbox_folder_url, import_state, dropbox_last_synced_at, dropbox_cover_image_name, events(owner_id)",
    )
    .eq("id", albumId)
    .maybeSingle();

  if (!album) throw new HttpError(404, "Album not found.");

  const ownerId = (album as Row).events?.owner_id as string | undefined;
  if (!ownerId) throw new HttpError(500, "Album has no owner.");

  if (album.source_type !== "dropbox" || !album.dropbox_folder_url) {
    throw new HttpError(400, "This album is not linked to a Dropbox folder.");
  }

  return {
    albumId: album.id,
    title: album.title,
    eventId: album.event_id,
    ownerId,
    folderUrl: album.dropbox_folder_url,
    importState: album.import_state ?? "live",
    lastSyncedAt: album.dropbox_last_synced_at ?? null,
    coverImageName: album.dropbox_cover_image_name ?? null,
  };
}

function toFileMeta(entry: DropboxEntry): DropboxFileMeta {
  return {
    id: entry.id ?? "",
    name: entry.name,
    rev: entry.rev ?? "",
    size: entry.size ?? 0,
    content_hash: entry.content_hash,
    client_modified: entry.client_modified,
    path_lower: entry.path_lower,
  };
}

type DropboxListingResult =
  | { kind: "ok"; listing: Listing<DropboxFileMeta>; entries: DropboxEntry[] }
  | { kind: "revoked" };

/**
 * A complete listing, or an INCOMPLETE one carrying the reason. Never a silent
 * partial: listSharedFolder either returns everything or throws, and the throw
 * becomes `complete: false`, which the diff turns into "no deletions".
 */
async function dropboxListing(folderUrl: string): Promise<DropboxListingResult> {
  try {
    const entries = await listSharedFolder(folderUrl);
    const files = entries.filter((entry) => entry[".tag"] === "file").map(toFileMeta);
    return { kind: "ok", listing: { complete: true, items: files }, entries };
  } catch (err) {
    if (isSharedLinkGone(err)) return { kind: "revoked" };
    const reason = err instanceof Error ? err.message : String(err);
    console.error("dropbox-sync: listing failed:", reason);
    return { kind: "ok", listing: { complete: false, items: [], reason }, entries: [] };
  }
}

/**
 * Every photo row of the album, paged explicitly and asserted against an exact
 * count. PostgREST truncates at max_rows = 1000 without an error; a truncated
 * DB side would make stored photos look like they need re-adding, and - worse -
 * anything past the cap could not be matched, so it must be flagged.
 */
async function dbListing(db: AdminClient, albumId: string): Promise<Listing<DbPhotoRow>> {
  const { count, error: countError } = await db
    .from("photos")
    .select("id", { count: "exact", head: true })
    .eq("album_id", albumId);
  if (countError) throw countError;

  const rows: DbPhotoRow[] = [];
  for (let from = 0; ; from += DB_PAGE_SIZE) {
    const { data, error } = await db
      .from("photos")
      .select("id, dropbox_file_id, dropbox_name, dropbox_rev, dropbox_size, deleted_at")
      .eq("album_id", albumId)
      .order("id")
      .range(from, from + DB_PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as DbPhotoRow[]));
    if (!data || data.length < DB_PAGE_SIZE) break;
  }

  if (count !== null && rows.length === count) return { complete: true, items: rows };
  return { complete: false, items: rows, reason: `read ${rows.length} of ${count ?? "?"} rows` };
}

async function storageUsageBytes(db: AdminClient): Promise<number> {
  const { data, error } = await db.rpc("photos_bucket_usage_bytes");
  if (error) throw error;
  return Number(data ?? 0);
}

async function activeRun(db: AdminClient, albumId: string): Promise<Row | null> {
  const { data } = await db
    .from("sync_runs")
    .select("*")
    .eq("album_id", albumId)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------
async function validate(req: Request, body: Row) {
  const album = await authorizeAlbum(req, body.albumId);
  const db = adminClient();

  const [listing, usedBytes, running] = await Promise.all([
    dropboxListing(album.folderUrl),
    storageUsageBytes(db),
    activeRun(db, album.albumId),
  ]);

  if (listing.kind === "revoked") {
    return json({
      ok: false,
      error: "revoked_link",
      message: "Dropbox no longer serves this shared link. Re-share the folder and update the album's link.",
      importState: album.importState,
      activeRunId: running?.id ?? null,
    }, 200);
  }

  const files = listing.entries.filter((entry) => entry[".tag"] === "file");
  const images = files.filter((entry) =>
    DEFAULT_SYNC_OPTIONS.imageExtensions.some((ext) => entry.name.toLowerCase().endsWith(ext))
  );

  return json({
    ok: true,
    listing: {
      complete: listing.listing.complete,
      reason: listing.listing.complete ? null : listing.listing.reason,
      fileCount: files.length,
      imageCount: images.length,
      totalBytes: images.reduce((sum, entry) => sum + (entry.size ?? 0), 0),
      over20MB: images.filter((entry) => (entry.size ?? 0) > DEFAULT_SYNC_OPTIONS.thumbnailMaxBytes).length,
      // Shared-link listings may omit metadata; the diff degrades gracefully
      // but the owner should know before importing.
      hasIds: images.every((entry) => !!entry.id),
      hasRevs: images.every((entry) => !!entry.rev),
      hasHashes: images.every((entry) => !!entry.content_hash),
      sample: images.slice(0, 5).map((entry) => entry.name),
    },
    storage: { usedBytes, quotaBytes: QUOTA_BYTES },
    importState: album.importState,
    lastSyncedAt: album.lastSyncedAt,
    activeRunId: running?.id ?? null,
  }, 200);
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------
interface StoredPlan extends Omit<SyncPlan, "additions"> {
  /** Additions carry the photo id they WILL get, assigned once here so a
   *  retried chunk reuses the same id and storage path. */
  additions: Array<PlannedAddition & { photoId: string }>;
}

async function coversAffectedBy(
  db: AdminClient,
  album: AlbumContext,
  deletedNames: string[],
): Promise<Array<{ level: "album" | "event" | "profile"; name: string }>> {
  if (deletedNames.length === 0) return [];
  const gone = new Set(deletedNames.map((name) => name.toLowerCase()));
  const affected: Array<{ level: "album" | "event" | "profile"; name: string }> = [];

  if (album.coverImageName && gone.has(album.coverImageName.toLowerCase())) {
    affected.push({ level: "album", name: album.coverImageName });
  }

  const [{ data: events }, { data: profiles }] = await Promise.all([
    db.from("events").select("dropbox_cover_image_name").eq("dropbox_cover_album_id", album.albumId),
    db.from("profiles").select("dropbox_cover_image_name").eq("dropbox_cover_album_id", album.albumId),
  ]);
  for (const row of events ?? []) {
    if (row.dropbox_cover_image_name && gone.has(row.dropbox_cover_image_name.toLowerCase())) {
      affected.push({ level: "event", name: row.dropbox_cover_image_name });
    }
  }
  for (const row of profiles ?? []) {
    if (row.dropbox_cover_image_name && gone.has(row.dropbox_cover_image_name.toLowerCase())) {
      affected.push({ level: "profile", name: row.dropbox_cover_image_name });
    }
  }
  return affected;
}

async function plan(req: Request, body: Row) {
  const album = await authorizeAlbum(req, body.albumId);
  const db = adminClient();

  const running = await activeRun(db, album.albumId);
  if (running) {
    return json({ error: "run_active", message: "A sync is already in progress for this album.", runId: running.id }, 409);
  }

  const [dbSide, dropboxSide, usedBytes] = await Promise.all([
    dbListing(db, album.albumId),
    dropboxListing(album.folderUrl),
    storageUsageBytes(db),
  ]);

  if (dropboxSide.kind === "revoked") {
    return json({ error: "revoked_link", message: "Dropbox no longer serves this shared link." }, 409);
  }

  const computed = computeSyncPlan(dbSide, dropboxSide.listing, DEFAULT_SYNC_OPTIONS);

  const stored: StoredPlan = {
    ...computed,
    additions: computed.additions.map((addition) => ({ ...addition, photoId: crypto.randomUUID() })),
  };

  const downloads =
    stored.additions.length + stored.updates.length + stored.restores.filter((r) => r.needsDownload).length;
  const projectedBytes = usedBytes + stored.bytesToDownload + downloads * THUMB_BYTES_ESTIMATE;
  const refusedForQuota = projectedBytes > QUOTA_REFUSE_RATIO * QUOTA_BYTES;

  const totalItems =
    stored.additions.length + stored.updates.length + stored.renames.length +
    stored.restores.length + stored.deletions.length;

  const { data: run, error } = await db
    .from("sync_runs")
    .insert({
      album_id: album.albumId,
      status: "planned",
      listing_complete: dbSide.complete && dropboxSide.listing.complete,
      plan: stored,
      total_items: totalItems,
    })
    .select("id, created_at")
    .single();

  if (error) {
    // Partial unique index: another tab planned in the meantime.
    if ((error as Row).code === "23505") {
      const other = await activeRun(db, album.albumId);
      return json({ error: "run_active", message: "A sync is already in progress for this album.", runId: other?.id ?? null }, 409);
    }
    throw error;
  }

  return json({
    runId: run.id,
    plan: stored,
    storage: { usedBytes, projectedBytes, quotaBytes: QUOTA_BYTES, refusedForQuota },
    coversAffected: await coversAffectedBy(db, album, stored.deletions.map((d) => d.name)),
    expiresAt: new Date(new Date(run.created_at).getTime() + PLAN_TTL_MS).toISOString(),
  }, 200);
}

// ---------------------------------------------------------------------------
// status / cancel
// ---------------------------------------------------------------------------
async function status(req: Request, body: Row) {
  const album = await authorizeAlbum(req, body.albumId);
  const db = adminClient();

  const [running, { data: latest }] = await Promise.all([
    activeRun(db, album.albumId),
    db
      .from("sync_runs")
      .select("*")
      .eq("album_id", album.albumId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return json({ active: running, latest: latest ?? null, importState: album.importState, lastSyncedAt: album.lastSyncedAt }, 200);
}

async function cancel(req: Request, body: Row) {
  const runId = body.runId as string | undefined;
  if (!runId) throw new HttpError(400, "runId is required");

  const db = adminClient();
  const { data: run } = await db.from("sync_runs").select("id, album_id, status").eq("id", runId).maybeSingle();
  if (!run) throw new HttpError(404, "Sync run not found.");

  // Ownership is proven via the run's album, with the caller's own JWT.
  await authorizeAlbum(req, run.album_id);

  if (!ACTIVE_STATUSES.includes(run.status)) {
    return json({ runId, status: run.status }, 200);
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from("sync_runs")
    .update({ status: "cancelled", finished_at: now, updated_at: now })
    .eq("id", runId)
    .in("status", ACTIVE_STATUSES);
  if (error) throw error;

  return json({ runId, status: "cancelled" }, 200);
}

// ---------------------------------------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const body: Row = await req.json();

    switch (body?.action) {
      case "validate":
        return await validate(req, body);
      case "plan":
        return await plan(req, body);
      case "status":
        return await status(req, body);
      case "cancel":
        return await cancel(req, body);
      case "apply":
        // Lands in the next release, once the plan/census has run against the
        // real albums. Refusing loudly beats a half-implemented import.
        return json({ error: "apply is not available in this release." }, 501);
      default:
        return json({ error: 'Invalid action. Use "validate", "plan", "status", "cancel" or "apply".' }, 400);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      return json({ error: err.message, ...err.extra }, err.status);
    }
    console.error("dropbox-sync failed:", err instanceof Error ? err.message : err);
    return json({ error: "Request failed." }, 500);
  }
});
