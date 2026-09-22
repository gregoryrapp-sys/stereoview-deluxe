/**
 * The Dropbox sync diff. Pure: no network, no Supabase, no Deno globals, so it
 * runs unchanged in the edge function and under Vitest.
 *
 * This is the entire safety surface of the sync. The governing principle:
 *
 *   A deletion requires positive proof that the file is gone. The absence of
 *   proof that it exists is never enough.
 *
 * A rate-limited page, a revoked link, a renamed folder or PostgREST's silent
 * 1000-row cap all produce a SHORT listing, and a short listing fed into a
 * naive diff reads exactly like "the photographer deleted these". So:
 *
 *  - Both inputs carry `complete`. Either side incomplete -> zero deletions.
 *  - An empty listing against a non-empty album is refused outright.
 *  - Identity is dropbox_file_id only. Rows without one (manual uploads) can
 *    never be deleted by a sync. Names are display metadata; rev/content_hash
 *    detect change, never identity.
 *  - Large deletions require the owner to type the album name.
 *  - Deletions are soft (deleted_at); storage is never touched by a sync.
 *  - Output ordering is deterministic so a persisted plan is stable.
 */

export type Listing<T> =
  | { complete: true; items: T[] }
  | { complete: false; items: T[]; reason: string };

export interface DbPhotoRow {
  id: string;
  dropbox_file_id: string | null;
  dropbox_name: string | null;
  dropbox_rev: string | null;
  dropbox_size: number | null;
  deleted_at: string | null;
}

export interface DropboxFileMeta {
  id: string;
  name: string;
  rev: string;
  size: number;
  content_hash?: string;
  client_modified?: string;
  path_lower?: string;
}

export interface SyncPlanOptions {
  /** Deletions above max(deleteThresholdMin, ceil(live * pct / 100)) need a typed confirmation. */
  deleteThresholdPct: number;
  deleteThresholdMin: number;
  /** Files above this are skipped (the bucket refuses them anyway). */
  maxFileBytes: number;
  /** Dropbox's thumbnail endpoint only serves sources up to this size. */
  thumbnailMaxBytes: number;
  imageExtensions: string[];
}

export type SkipReason = "not_image" | "too_large" | "no_id" | "duplicate_id";

export type RefusalCode = "empty_listing" | "incomplete_dropbox_listing" | "incomplete_db_listing";

export interface PlannedAddition {
  file: DropboxFileMeta;
  thumbnailEligible: boolean;
}

export interface PlannedUpdate {
  photoId: string;
  file: DropboxFileMeta;
  thumbnailEligible: boolean;
}

export interface PlannedRename {
  photoId: string;
  from: string;
  file: DropboxFileMeta;
}

export interface PlannedRestore {
  photoId: string;
  file: DropboxFileMeta;
  /** The rev changed while the row was soft-deleted, so the bytes must be fetched again. */
  needsDownload: boolean;
  thumbnailEligible: boolean;
}

export interface PlannedDeletion {
  photoId: string;
  name: string;
}

export interface SyncPlan {
  additions: PlannedAddition[];
  updates: PlannedUpdate[];
  renames: PlannedRename[];
  restores: PlannedRestore[];
  /** Always soft. Empty unless BOTH listings are complete and the listing is non-empty. */
  deletions: PlannedDeletion[];
  unchanged: number;
  skipped: Array<{ name: string; reason: SkipReason }>;
  refusal?: { code: RefusalCode; message: string };
  requiresTypedConfirmation: boolean;
  bytesToDownload: number;
}

export const DEFAULT_SYNC_OPTIONS: SyncPlanOptions = {
  deleteThresholdPct: 10,
  deleteThresholdMin: 5,
  maxFileBytes: 50 * 1024 * 1024,
  thumbnailMaxBytes: 20 * 1024 * 1024,
  imageExtensions: [".jpg", ".jpeg", ".png", ".webp"],
};

function isImageName(name: string, extensions: string[]): boolean {
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

function byNameThenId(a: DropboxFileMeta, b: DropboxFileMeta): number {
  const n = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  return n !== 0 ? n : a.id.localeCompare(b.id);
}

export function computeSyncPlan(
  db: Listing<DbPhotoRow>,
  dropbox: Listing<DropboxFileMeta>,
  opts: SyncPlanOptions = DEFAULT_SYNC_OPTIONS,
): SyncPlan {
  const plan: SyncPlan = {
    additions: [],
    updates: [],
    renames: [],
    restores: [],
    deletions: [],
    unchanged: 0,
    skipped: [],
    requiresTypedConfirmation: false,
    bytesToDownload: 0,
  };

  // --- Dropbox side: filter, dedupe, sort -----------------------------------
  const seenIds = new Set<string>();
  const files: DropboxFileMeta[] = [];
  for (const file of [...dropbox.items].sort(byNameThenId)) {
    if (!isImageName(file.name, opts.imageExtensions)) {
      plan.skipped.push({ name: file.name, reason: "not_image" });
    } else if (!file.id) {
      plan.skipped.push({ name: file.name, reason: "no_id" });
    } else if (seenIds.has(file.id)) {
      plan.skipped.push({ name: file.name, reason: "duplicate_id" });
    } else if (file.size > opts.maxFileBytes) {
      plan.skipped.push({ name: file.name, reason: "too_large" });
    } else {
      seenIds.add(file.id);
      files.push(file);
    }
  }

  // --- DB side --------------------------------------------------------------
  const liveSynced = db.items.filter((row) => row.deleted_at === null && row.dropbox_file_id);
  const liveById = new Map(liveSynced.map((row) => [row.dropbox_file_id as string, row]));
  const deletedById = new Map(
    db.items
      .filter((row) => row.deleted_at !== null && row.dropbox_file_id)
      .map((row) => [row.dropbox_file_id as string, row]),
  );

  // --- Refusals -------------------------------------------------------------
  // Empty listing against an album that has synced photos is the exact
  // signature of a revoked link or a renamed folder. Refuse everything - no
  // additions either, because there is nothing to add - and offer no override.
  if (files.length === 0 && liveSynced.length > 0) {
    plan.refusal = {
      code: "empty_listing",
      message:
        "Dropbox returned no images for this folder while the album has synced photos. " +
        "This usually means the shared link was revoked or the folder was moved. Nothing was changed.",
    };
    return plan;
  }

  const deletionsAllowed = db.complete && dropbox.complete;
  // Explicit comparisons: this repo compiles without strictNullChecks, where a
  // truthiness test does not narrow the discriminant.
  if (dropbox.complete === false) {
    plan.refusal = {
      code: "incomplete_dropbox_listing",
      message: `The Dropbox listing was incomplete (${dropbox.reason}). Additions and updates can proceed; nothing will be removed.`,
    };
  } else if (db.complete === false) {
    plan.refusal = {
      code: "incomplete_db_listing",
      message: `Not every stored photo could be read (${db.reason}). Additions and updates can proceed; nothing will be removed.`,
    };
  }

  // --- Match ----------------------------------------------------------------
  for (const file of files) {
    const thumbnailEligible = file.size <= opts.thumbnailMaxBytes;
    const live = liveById.get(file.id);

    if (live) {
      if (live.dropbox_rev !== file.rev) {
        plan.updates.push({ photoId: live.id, file, thumbnailEligible });
        plan.bytesToDownload += file.size;
      } else if (live.dropbox_name !== file.name) {
        // Same id, same bytes, different name - including case-only renames.
        plan.renames.push({ photoId: live.id, from: live.dropbox_name ?? "", file });
      } else {
        plan.unchanged += 1;
      }
      continue;
    }

    const deleted = deletedById.get(file.id);
    if (deleted) {
      const needsDownload = deleted.dropbox_rev !== file.rev;
      plan.restores.push({ photoId: deleted.id, file, needsDownload, thumbnailEligible });
      if (needsDownload) plan.bytesToDownload += file.size;
      continue;
    }

    plan.additions.push({ file, thumbnailEligible });
    plan.bytesToDownload += file.size;
  }

  // --- Deletions ------------------------------------------------------------
  if (deletionsAllowed) {
    for (const row of liveSynced) {
      if (!seenIds.has(row.dropbox_file_id as string)) {
        plan.deletions.push({ photoId: row.id, name: row.dropbox_name ?? row.id });
      }
    }
    plan.deletions.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.photoId.localeCompare(b.photoId));

    const threshold = Math.max(
      opts.deleteThresholdMin,
      Math.ceil((liveSynced.length * opts.deleteThresholdPct) / 100),
    );
    plan.requiresTypedConfirmation = plan.deletions.length > threshold;
  }

  return plan;
}

/**
 * Applies a plan to an in-memory copy of the DB rows, for tests and previews.
 * Mirrors what `apply` does to the real table (ids for additions are supplied
 * by the caller, as the edge function does at plan time).
 */
export function applyPlanToRows(
  rows: DbPhotoRow[],
  plan: SyncPlan,
  newIdFor: (file: DropboxFileMeta) => string,
  now = "2026-01-01T00:00:00Z",
): DbPhotoRow[] {
  const next = new Map(rows.map((row) => [row.id, { ...row }]));

  for (const { file } of plan.additions) {
    next.set(newIdFor(file), {
      id: newIdFor(file),
      dropbox_file_id: file.id,
      dropbox_name: file.name,
      dropbox_rev: file.rev,
      dropbox_size: file.size,
      deleted_at: null,
    });
  }
  for (const { photoId, file } of plan.updates) {
    const row = next.get(photoId);
    if (row) Object.assign(row, { dropbox_rev: file.rev, dropbox_name: file.name, dropbox_size: file.size });
  }
  for (const { photoId, file } of plan.renames) {
    const row = next.get(photoId);
    if (row) row.dropbox_name = file.name;
  }
  for (const { photoId, file } of plan.restores) {
    const row = next.get(photoId);
    if (row) Object.assign(row, { deleted_at: null, dropbox_rev: file.rev, dropbox_name: file.name, dropbox_size: file.size });
  }
  for (const { photoId } of plan.deletions) {
    const row = next.get(photoId);
    if (row) row.deleted_at = now;
  }

  return [...next.values()];
}
