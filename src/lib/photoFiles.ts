/**
 * One stored file can be shown in several albums: each album has its own
 * photos row pointing at the same storage_path (and thumb_path). A file is
 * deleted from Storage only when no row uses it any more.
 */
export interface PhotoFiles {
  storage_path: string;
  thumb_path: string | null;
}

/**
 * The Storage objects that can go once these rows are deleted: the original
 * and thumbnail of every file no remaining row uses. `remainingUses` counts the
 * rows still pointing at each storage_path after the delete (soft-deleted rows
 * included, so a photo a Dropbox sync removed can still be restored).
 */
export function unusedObjects(deleted: PhotoFiles[], remainingUses: Map<string, number>): string[] {
  const out = new Set<string>();
  for (const file of deleted) {
    if ((remainingUses.get(file.storage_path) ?? 0) > 0) continue;
    out.add(file.storage_path);
    if (file.thumb_path) out.add(file.thumb_path);
  }
  return [...out];
}

/** How many albums show each file, from the photos the page has loaded. */
export function albumCountsByFile(photos: Array<{ storagePath?: string | null }>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const photo of photos) {
    if (!photo.storagePath) continue;
    counts.set(photo.storagePath, (counts.get(photo.storagePath) ?? 0) + 1);
  }
  return counts;
}
