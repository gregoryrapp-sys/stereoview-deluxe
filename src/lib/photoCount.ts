import type { ListingStatus } from '@/hooks/useDropboxListing';

const plural = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`;

/**
 * The photo count under an album title, never a number that is about to change:
 * - a Dropbox folder still being listed has no count yet ("Counting photos…");
 * - once listed, the total is final; previews still arriving are shown apart
 *   from it ("57 photos · previews 12 of 57"), so a partial number is never
 *   read as the size of the album.
 */
export function photoCountLabel({
  total,
  status = 'ready',
  previewsSettled,
}: {
  total: number;
  status?: ListingStatus;
  /** Dropbox previews fetched (or failed) so far; omitted for stored photos. */
  previewsSettled?: number;
}): { count: string; progress: string | null } {
  if (status === 'loading') return { count: 'Counting photos…', progress: null };
  if (status === 'error') return { count: 'Photos could not be listed', progress: null };
  const progress =
    previewsSettled !== undefined && previewsSettled < total ? `previews ${previewsSettled} of ${total}` : null;
  return { count: plural(total), progress };
}
