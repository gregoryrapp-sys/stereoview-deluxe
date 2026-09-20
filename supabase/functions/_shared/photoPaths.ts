/**
 * Storage object paths for photos - Deno copy of src/lib/photoPaths.ts.
 * Edge functions cannot import from src/; keep the two files identical.
 */

/** Whole side-by-side image, downscaled to this width (512 px per eye). */
export const THUMB_MAX_WIDTH = 1024;

export type ThumbExtension = "webp" | "jpg";

export function photoObjectPath(
  ownerId: string,
  eventId: string,
  albumId: string,
  photoId: string,
  extension = "jpg",
): string {
  return `${ownerId}/events/${eventId}/albums/${albumId}/photos/${photoId}/stereo.${extension}`;
}

export function deriveThumbPath(storagePath: string, extension: ThumbExtension): string {
  return storagePath.replace(/\.[^./]+$/, "") + `.thumb.${extension}`;
}
