/**
 * Storage object paths for photos.
 *
 * One place for the path scheme, shared by uploads, moves, deletes and the
 * thumbnail pipeline. A copy lives at supabase/functions/_shared/photoPaths.ts
 * for the Deno side, which cannot import from src/; keep the two identical.
 *
 * The first path segment is the owner's uid: storage RLS for INSERT/UPDATE/
 * DELETE checks `(storage.foldername(name))[1] = auth.uid()::text`.
 */

/** Whole side-by-side image, downscaled to this width (512 px per eye). */
export const THUMB_MAX_WIDTH = 1024;

export type ThumbExtension = 'webp' | 'jpg';

export function photoObjectPath(
  ownerId: string,
  eventId: string,
  albumId: string,
  photoId: string,
  extension = 'jpg',
): string {
  return `${ownerId}/events/${eventId}/albums/${albumId}/photos/${photoId}/stereo.${extension}`;
}

/**
 * The thumbnail lives next to its original: `.../stereo.jpg` ->
 * `.../stereo.thumb.webp`. Derived rather than stored separately so a move can
 * carry both objects with one rule, and so legacy paths without a
 * `/photos/<uuid>/` segment get a thumbnail too.
 */
export function deriveThumbPath(storagePath: string, extension: ThumbExtension): string {
  return storagePath.replace(/\.[^./]+$/, '') + `.thumb.${extension}`;
}
