import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { type AdminClient, adminClient, userClient } from "../_shared/supabaseAdmin.ts";
import {
  downloadSharedFile,
  type DropboxEntry,
  dropboxContentHash,
  getSharedFileThumbnail,
  isSharedLinkGone,
  isThumbnailUnsupported,
  listSharedFolder,
} from "../_shared/dropbox.ts";
import { deriveThumbPath, photoObjectPath, type ThumbExtension } from "../_shared/photoPaths.ts";
import {
  computeSyncPlan,
  DEFAULT_SYNC_OPTIONS,
  type DbPhotoRow,
  type DropboxFileMeta,
  type Listing,
  type PlannedAddition,
  type PlannedDeletion,
  type PlannedRename,
  type PlannedRestore,
  type PlannedUpdate,
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

// One `apply` call does at most this much, then returns its cursor and the
// client calls again. Free-plan functions have a 150 s wall clock; 80 s of
// work plus one stalled 40 s download still fits with room to persist state.
const CHUNK_MAX_ITEMS = 20;
const CHUNK_DEADLINE_MS = 80_000;
const DOWNLOAD_TIMEOUT_MS = 40_000;
const PHOTOS_BUCKET = "photos";
/** Imported objects are write-once under a UUID path; cache them for a year. */
const PHOTO_CACHE_CONTROL = "31536000";

const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

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

  // `events!albums_event_id_fkey`: albums and events are joined by two foreign
  // keys (the album's event, and an event's Dropbox cover album), so a bare
  // `events(...)` embed is ambiguous and PostgREST answers 300 instead of rows.
  const { data: album, error: albumError } = await caller
    .from("albums")
    .select(
      "id, title, event_id, source_type, dropbox_folder_url, import_state, dropbox_last_synced_at, dropbox_cover_image_name, events!albums_event_id_fkey(owner_id)",
    )
    .eq("id", albumId)
    .maybeSingle();

  // A query error is not "no row": say what PostgREST said instead of 404.
  if (albumError) throw new HttpError(500, `Album lookup failed: ${albumError.message}`);
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
// apply
// ---------------------------------------------------------------------------
type PlanItem =
  | { kind: "add"; item: PlannedAddition & { photoId: string } }
  | { kind: "update"; item: PlannedUpdate }
  | { kind: "rename"; item: PlannedRename }
  | { kind: "restore"; item: PlannedRestore }
  | { kind: "delete"; item: PlannedDeletion };

/** Fixed order so `cursor` means the same thing on every call. */
function flattenPlan(plan: StoredPlan): PlanItem[] {
  return [
    ...plan.additions.map((item) => ({ kind: "add", item }) as PlanItem),
    ...plan.updates.map((item) => ({ kind: "update", item }) as PlanItem),
    ...plan.renames.map((item) => ({ kind: "rename", item }) as PlanItem),
    ...plan.restores.map((item) => ({ kind: "restore", item }) as PlanItem),
    ...plan.deletions.map((item) => ({ kind: "delete", item }) as PlanItem),
  ];
}

interface Applied {
  added: number;
  updated: number;
  renamed: number;
  restored: number;
  deleted: number;
  thumbsMissing: number;
}

interface ApplyError {
  name: string;
  fileId?: string;
  stage: "download" | "verify" | "upload" | "thumb" | "db";
  message: string;
}

class StageError extends Error {
  constructor(readonly stage: ApplyError["stage"], message: string) {
    super(message);
  }
}

function extensionOf(name: string): string {
  return (/\.([a-zA-Z0-9]+)$/.exec(name)?.[1] ?? "jpg").toLowerCase();
}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/**
 * The service role bypasses the storage policy that pins every object under
 * its owner's uid. This is the check that policy would have made.
 */
function assertOwnerPrefix(path: string, ownerId: string): void {
  if (!path.startsWith(`${ownerId}/`)) {
    throw new StageError("upload", `Refusing to write outside the owner's folder: ${path}`);
  }
}

/**
 * Downloads one file, proves it is the file Dropbox described, and stores it
 * with its thumbnail. Idempotent: paths derive from the pre-assigned photo id,
 * uploads upsert, and the row is upserted on id - so a retried chunk that
 * already did this work simply does it again with the same result.
 */
async function importFile(
  db: AdminClient,
  album: AlbumContext,
  photoId: string,
  file: DropboxFileMeta,
  thumbnailEligible: boolean,
  applied: Applied,
): Promise<{ storagePath: string; thumbPath: string | null }> {
  const extension = extensionOf(file.name);
  const storagePath = photoObjectPath(album.ownerId, album.eventId, album.albumId, photoId, extension);
  assertOwnerPrefix(storagePath, album.ownerId);

  // Download
  let bytes: ArrayBuffer;
  try {
    const response = await downloadSharedFile(album.folderUrl, file.name, {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    bytes = await response.arrayBuffer();
  } catch (err) {
    throw new StageError("download", err instanceof Error ? err.message : String(err));
  }

  // Verify: right length, and right bytes when Dropbox told us the hash.
  if (file.size && bytes.byteLength !== file.size) {
    throw new StageError("verify", `Downloaded ${bytes.byteLength} bytes, Dropbox reports ${file.size}`);
  }
  if (file.content_hash) {
    const hash = await dropboxContentHash(bytes);
    if (hash !== file.content_hash) {
      throw new StageError("verify", "Content hash does not match Dropbox");
    }
  }

  // Original
  const { error: uploadError } = await db.storage.from(PHOTOS_BUCKET).upload(storagePath, bytes, {
    contentType: MIME_BY_EXTENSION[extension] ?? "image/jpeg",
    cacheControl: PHOTO_CACHE_CONTROL,
    upsert: true,
  });
  if (uploadError) throw new StageError("upload", uploadError.message);

  // Thumbnail, rendered by Dropbox. Never fatal: a missing thumb means the grid
  // uses the original until the owner runs "Generate missing thumbnails".
  let thumbPath: string | null = null;
  if (thumbnailEligible) {
    thumbPath = await importThumbnail(db, album, file, storagePath);
    if (!thumbPath) applied.thumbsMissing += 1;
  } else {
    applied.thumbsMissing += 1;
  }

  return { storagePath, thumbPath };
}

async function importThumbnail(
  db: AdminClient,
  album: AlbumContext,
  file: DropboxFileMeta,
  storagePath: string,
): Promise<string | null> {
  for (const format of ["webp", "jpeg"] as const) {
    try {
      const response = await getSharedFileThumbnail(album.folderUrl, file.name, {
        format,
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
      const bytes = await response.arrayBuffer();
      const extension: ThumbExtension = format === "webp" ? "webp" : "jpg";
      const thumbPath = deriveThumbPath(storagePath, extension);
      assertOwnerPrefix(thumbPath, album.ownerId);
      const { error } = await db.storage.from(PHOTOS_BUCKET).upload(thumbPath, bytes, {
        contentType: format === "webp" ? "image/webp" : "image/jpeg",
        cacheControl: PHOTO_CACHE_CONTROL,
        upsert: true,
      });
      if (error) {
        console.warn(`dropbox-sync: thumbnail upload failed for ${file.name}: ${error.message}`);
        return null;
      }
      return thumbPath;
    } catch (err) {
      // WebP output can be refused for some sources; JPEG is the retry. Anything
      // the endpoint cannot render at all is not retried.
      if (isThumbnailUnsupported(err) && format === "webp") continue;
      console.warn(`dropbox-sync: thumbnail failed for ${file.name}:`, err instanceof Error ? err.message : err);
      return null;
    }
  }
  return null;
}

async function applyItem(
  db: AdminClient,
  album: AlbumContext,
  entry: PlanItem,
  applied: Applied,
  now: string,
): Promise<void> {
  const rowFor = (photoId: string, file: DropboxFileMeta, paths: { storagePath: string; thumbPath: string | null }) => ({
    id: photoId,
    album_id: album.albumId,
    storage_path: paths.storagePath,
    thumb_path: paths.thumbPath,
    alt: baseName(file.name),
    file_modified_at: file.client_modified ?? null,
    dropbox_file_id: file.id,
    dropbox_name: file.name,
    dropbox_rev: file.rev,
    dropbox_content_hash: file.content_hash ?? null,
    dropbox_size: file.size,
    source_synced_at: now,
    deleted_at: null,
  });

  const upsert = async (row: Row) => {
    const { error } = await db.from("photos").upsert(row, { onConflict: "id" });
    if (error) throw new StageError("db", error.message);
  };

  const update = async (photoId: string, patch: Row) => {
    const { data, error } = await db.from("photos").update(patch).eq("id", photoId).select("id");
    if (error) throw new StageError("db", error.message);
    if (!data || data.length === 0) throw new StageError("db", "Photo row not found");
  };

  switch (entry.kind) {
    case "add": {
      const paths = await importFile(db, album, entry.item.photoId, entry.item.file, entry.item.thumbnailEligible, applied);
      await upsert(rowFor(entry.item.photoId, entry.item.file, paths));
      applied.added += 1;
      return;
    }
    case "update": {
      const paths = await importFile(db, album, entry.item.photoId, entry.item.file, entry.item.thumbnailEligible, applied);
      await upsert(rowFor(entry.item.photoId, entry.item.file, paths));
      applied.updated += 1;
      return;
    }
    case "restore": {
      if (entry.item.needsDownload) {
        const paths = await importFile(db, album, entry.item.photoId, entry.item.file, entry.item.thumbnailEligible, applied);
        await upsert(rowFor(entry.item.photoId, entry.item.file, paths));
      } else {
        await update(entry.item.photoId, {
          deleted_at: null,
          dropbox_name: entry.item.file.name,
          dropbox_rev: entry.item.file.rev,
          alt: baseName(entry.item.file.name),
          source_synced_at: now,
        });
      }
      applied.restored += 1;
      return;
    }
    case "rename": {
      await update(entry.item.photoId, {
        dropbox_name: entry.item.file.name,
        dropbox_rev: entry.item.file.rev,
        alt: baseName(entry.item.file.name),
        source_synced_at: now,
      });
      applied.renamed += 1;
      return;
    }
    case "delete": {
      // Soft. The object stays in Storage; Restore is one UPDATE away.
      await update(entry.item.photoId, { deleted_at: now, source_synced_at: now });
      applied.deleted += 1;
      return;
    }
  }
}

/**
 * Remaps covers that pointed at a Dropbox file NAME to the imported photo row.
 * Unresolved names are returned, never nulled - the live-mode fallback still
 * works for them if the album is flipped back.
 */
async function remapCovers(db: AdminClient, album: AlbumContext): Promise<string[]> {
  const { data: rows } = await db
    .from("photos")
    .select("id, dropbox_name")
    .eq("album_id", album.albumId)
    .is("deleted_at", null)
    .not("dropbox_name", "is", null);
  const byName = new Map((rows ?? []).map((row) => [String(row.dropbox_name).toLowerCase(), row.id as string]));
  const unresolved: string[] = [];

  const resolve = (name: string | null): string | null | undefined => {
    if (!name) return undefined;
    const id = byName.get(name.toLowerCase());
    if (!id) unresolved.push(name);
    return id ?? undefined;
  };

  const albumCover = resolve(album.coverImageName);
  if (albumCover) {
    await db.from("albums").update({ cover_photo_id: albumCover, dropbox_cover_image_name: null }).eq("id", album.albumId);
  }

  const { data: events } = await db
    .from("events")
    .select("id, dropbox_cover_image_name")
    .eq("dropbox_cover_album_id", album.albumId);
  for (const event of events ?? []) {
    const id = resolve(event.dropbox_cover_image_name);
    if (id) {
      await db
        .from("events")
        .update({ cover_photo_id: id, dropbox_cover_album_id: null, dropbox_cover_image_name: null })
        .eq("id", event.id);
    }
  }

  const { data: profiles } = await db
    .from("profiles")
    .select("id, dropbox_cover_image_name")
    .eq("dropbox_cover_album_id", album.albumId);
  for (const profile of profiles ?? []) {
    const id = resolve(profile.dropbox_cover_image_name);
    if (id) {
      await db
        .from("profiles")
        .update({ cover_photo_id: id, dropbox_cover_album_id: null, dropbox_cover_image_name: null })
        .eq("id", profile.id);
    }
  }

  return unresolved;
}

/**
 * The gate that flips import_state. All must hold:
 *  1. no item errored;
 *  2. the live synced-row count equals what the plan said would exist;
 *  3. a sample of imported objects has the size Dropbox reported.
 */
async function verifyImport(
  db: AdminClient,
  album: AlbumContext,
  plan: StoredPlan,
  errors: ApplyError[],
): Promise<string | null> {
  if (errors.length > 0) {
    return `${errors.length} ${errors.length === 1 ? "item" : "items"} failed; nothing was marked imported`;
  }

  const expected =
    plan.additions.length + plan.updates.length + plan.renames.length + plan.restores.length + plan.unchanged;
  const { count } = await db
    .from("photos")
    .select("id", { count: "exact", head: true })
    .eq("album_id", album.albumId)
    .is("deleted_at", null)
    .not("dropbox_file_id", "is", null);
  if (count !== expected) {
    return `Expected ${expected} synced photos after applying, found ${count ?? "?"}`;
  }

  // Spot-check sizes: first, middle and last of what was downloaded.
  const downloaded = [
    ...plan.additions.map((a) => ({ photoId: a.photoId, file: a.file })),
    ...plan.updates.map((u) => ({ photoId: u.photoId, file: u.file })),
  ];
  const picks = downloaded.length <= 3
    ? downloaded
    : [downloaded[0], downloaded[Math.floor(downloaded.length / 2)], downloaded[downloaded.length - 1]];

  for (const pick of picks) {
    const { data: row } = await db.from("photos").select("storage_path").eq("id", pick.photoId).maybeSingle();
    if (!row?.storage_path) return `Imported row ${pick.photoId} has no storage path`;
    const folder = row.storage_path.slice(0, row.storage_path.lastIndexOf("/"));
    const name = row.storage_path.slice(row.storage_path.lastIndexOf("/") + 1);
    const { data: objects } = await db.storage.from(PHOTOS_BUCKET).list(folder, { search: name });
    const object = (objects ?? []).find((o) => o.name === name);
    const size = Number((object?.metadata as Row | undefined)?.size ?? -1);
    if (size !== pick.file.size) {
      return `Stored object for ${pick.file.name} is ${size} bytes, Dropbox reports ${pick.file.size}`;
    }
  }

  return null;
}

async function apply(req: Request, body: Row) {
  const runId = body.runId as string | undefined;
  if (!runId) throw new HttpError(400, "runId is required");

  const db = adminClient();
  const { data: run } = await db.from("sync_runs").select("*").eq("id", runId).maybeSingle();
  if (!run) throw new HttpError(404, "Sync run not found.");

  const album = await authorizeAlbum(req, run.album_id);
  const respond = (status: string, extra: Row = {}) =>
    json({ runId, status, cursor: run.cursor, total: run.total_items, applied: run.applied, errors: run.errors, ...extra }, 200);

  if (!ACTIVE_STATUSES.includes(run.status)) return respond(run.status);

  const plan = run.plan as StoredPlan;
  const now = () => new Date().toISOString();

  if (run.status === "planned") {
    if (Date.now() - new Date(run.created_at).getTime() > PLAN_TTL_MS) {
      await db.from("sync_runs").update({ status: "failed", error: "Plan expired before it was applied", finished_at: now(), updated_at: now() }).eq("id", runId);
      throw new HttpError(409, "This plan is older than an hour. Plan again to pick up any changes.", { code: "plan_expired" });
    }
    if (plan.refusal?.code === "empty_listing") {
      throw new HttpError(409, plan.refusal.message, { code: "refused" });
    }
    if (plan.requiresTypedConfirmation && !run.confirmed_at) {
      const typed = String(body.confirmation ?? "").trim();
      if (typed !== album.title.trim()) {
        throw new HttpError(409, `This sync removes ${plan.deletions.length} photos. Type the album name to confirm.`, {
          code: "confirmation_required",
        });
      }
    }

    // Only a FIRST import shows as 'importing'; a re-sync of an imported album
    // keeps serving its rows while it runs.
    if (album.importState !== "imported") {
      await db.from("albums").update({ import_state: "importing" }).eq("id", album.albumId);
    }
    await db
      .from("sync_runs")
      .update({ status: "applying", confirmed_at: run.confirmed_at ?? (plan.requiresTypedConfirmation ? now() : null), updated_at: now() })
      .eq("id", runId);
    run.status = "applying";
  }

  const items = flattenPlan(plan);
  let cursor = run.cursor as number;
  const applied = run.applied as Applied;
  const errors = run.errors as ApplyError[];
  const started = Date.now();
  let processed = 0;

  while (cursor < items.length && processed < CHUNK_MAX_ITEMS && Date.now() - started < CHUNK_DEADLINE_MS) {
    const entry = items[cursor];
    try {
      await applyItem(db, album, entry, applied, now());
    } catch (err) {
      // One bad file must not abandon the run. It is recorded, the item is
      // skipped, and import_state will not flip while errors exist.
      const file = "file" in entry.item ? entry.item.file : null;
      errors.push({
        name: file?.name ?? ("name" in entry.item ? entry.item.name : entry.kind),
        fileId: file?.id,
        stage: err instanceof StageError ? err.stage : "db",
        message: err instanceof Error ? err.message : String(err),
      });
    }
    cursor += 1;
    processed += 1;
    // Durable progress after every item, so a killed isolate loses at most one.
    await db.from("sync_runs").update({ cursor, applied, errors, updated_at: now() }).eq("id", runId);
  }

  if (cursor < items.length) {
    return json({ runId, status: "applying", cursor, total: items.length, applied, errors }, 200);
  }

  // Everything attempted; verify before anything flips.
  await db.from("sync_runs").update({ status: "verifying", updated_at: now() }).eq("id", runId);
  const failure = await verifyImport(db, album, plan, errors);

  if (failure) {
    await db
      .from("sync_runs")
      .update({ status: "failed", error: failure, finished_at: now(), updated_at: now() })
      .eq("id", runId);
    // A failed FIRST import leaves the album live (nothing lost); a failed
    // re-sync keeps the album imported and records the error.
    await db
      .from("albums")
      .update({
        import_state: album.importState === "imported" ? "imported" : "failed",
        dropbox_last_sync_error: failure,
      })
      .eq("id", album.albumId);
    return json({ runId, status: "failed", cursor, total: items.length, applied, errors, error: failure }, 200);
  }

  const unresolvedCovers = await remapCovers(db, album);
  const finishedAt = now();
  await db
    .from("albums")
    .update({ import_state: "imported", dropbox_last_synced_at: finishedAt, dropbox_last_sync_error: null })
    .eq("id", album.albumId);
  await db
    .from("sync_runs")
    .update({ status: "imported", finished_at: finishedAt, updated_at: finishedAt })
    .eq("id", runId);

  return json({ runId, status: "imported", cursor, total: items.length, applied, errors, unresolvedCovers }, 200);
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
  const album = await authorizeAlbum(req, run.album_id);

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

  // A cancelled FIRST import goes back to live streaming; rows already written
  // stay (a later plan sees them as unchanged or as updates). A cancelled
  // re-sync never left 'imported'.
  if (album.importState === "importing") {
    await db.from("albums").update({ import_state: "live" }).eq("id", album.albumId);
  }

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
        return await apply(req, body);
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
