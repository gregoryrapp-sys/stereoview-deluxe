import { useEffect, useRef, useState } from 'react';
import {
  type EyeSelection,
  peekProcessedImage,
  photoCacheKey,
  preloadStereoImages,
  type ProcessedStereoImage,
  resolveAlignment,
  splitStereoImage,
} from '@/lib/imageProcessing';
import type { DropboxFile, GalleryPhoto } from '@/services/galleryService';
import type { AlbumRecord } from '@/types/database';
import { isLiveDropboxAlbum } from '@/lib/albumSource';
import type { StereoAlignment } from '@/lib/stereoAlign/types';

interface UseProcessedImageResult {
  /** URL for the left half of the stereo image */
  leftUrl: string | null;
  /** URL for the right half, or null when only the left eye was requested */
  rightUrl: string | null;
  /** Whether the image is currently being processed */
  isLoading: boolean;
  /** Error message if processing failed */
  error: string | null;
  /** Dimensions of a single eye after downscaling */
  dimensions: { width: number; height: number } | null;
  /** The alignment the split actually used (after clamping). */
  appliedAlignment: StereoAlignment | null;
  /** Output px per source px of one eye, for previewing nudges without a re-split. */
  sourceScale: number | null;
}

type ProcessablePhoto = GalleryPhoto | DropboxFile;

interface ProcessedImageOptions {
  /** `'left'` skips the right eye entirely - halves the work in portrait/2D mode. */
  eyes?: EyeSelection;
  /** Overrides the photo's stored alignment (session swap, owner nudges). */
  alignment?: StereoAlignment;
}

type SourceAlbum =
  | (Pick<AlbumRecord, 'source_type' | 'dropbox_folder_url'> & { import_state?: AlbumRecord['import_state'] })
  | null;

function normalizePhoto(photo: ProcessablePhoto | string | null): ProcessablePhoto | null {
  // A bare string is a URL; treat it as a Supabase-style photo.
  if (typeof photo === 'string') {
    return { src: photo, id: photo, alt: '' } as GalleryPhoto;
  }
  if (photo && typeof photo === 'object' && photo.src) {
    return photo;
  }
  return null;
}

function dropboxFolderUrl(album: SourceAlbum): string | undefined {
  // Imported albums have signed `src` URLs like uploads; only live albums go
  // through the Dropbox proxy.
  return isLiveDropboxAlbum(album) ? album?.dropbox_folder_url ?? undefined : undefined;
}

/**
 * Processes a raw stereo image into its left/right halves.
 *
 * Effects here key on **strings**, not on the `photo` and `album` object
 * identities they used to depend on. Callers legitimately mint new photo objects
 * as data arrives - `PublicProfile` replaces one per resolved Dropbox blob - and
 * with object deps that re-ran this effect once per photo in the album while the
 * viewer was open, each time tearing down and re-creating the <img>.
 */
export function useProcessedImage(
  photo: ProcessablePhoto | string | null,
  album: SourceAlbum,
  options: ProcessedImageOptions = {},
): UseProcessedImageResult {
  const { eyes = 'both', alignment: alignmentOverride } = options;

  const photoObject = normalizePhoto(photo);
  const folderUrl = dropboxFolderUrl(album);
  const alignment = photoObject ? alignmentOverride ?? resolveAlignment(photoObject) : undefined;
  const cacheKey = photoObject ? photoCacheKey(photoObject, eyes, alignment) : null;

  // Read through a ref so the effect can use the latest object without taking a
  // dependency on its identity.
  const photoRef = useRef(photoObject);
  photoRef.current = photoObject;

  // Seeding from the cache means a hit renders on the very first paint rather
  // than flashing a spinner and then swapping in.
  const [result, setResult] = useState<ProcessedStereoImage | null>(
    () => (photoObject ? peekProcessedImage(photoObject, eyes, alignment) ?? null : null),
  );
  const [isLoading, setIsLoading] = useState(() => (photoObject ? !result : false));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const current = photoRef.current;

    if (!current || !cacheKey) {
      setResult(null);
      setIsLoading(false);
      setError(photo ? 'Invalid photo object provided for processing.' : null);
      return;
    }

    // A cache hit resolves synchronously. The previous implementation called
    // setIsLoading(true) and setResult(null) *before* awaiting, so even an
    // instant hit unmounted the image and flashed the loading state.
    // The override is re-derived here rather than captured, so the effect keys
    // on the string cacheKey (which already encodes it) and not on object identity.
    const effectiveAlignment = alignmentOverride ?? resolveAlignment(current);

    const hit = peekProcessedImage(current, eyes, effectiveAlignment);
    if (hit) {
      setResult(hit);
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setResult(null);
    setIsLoading(true);
    setError(null);

    splitStereoImage(current, folderUrl, eyes, { alignment: effectiveAlignment })
      .then((processed) => {
        if (cancelled) return;
        setResult(processed);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to process image');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, folderUrl, eyes]);

  return {
    leftUrl: result?.leftUrl ?? null,
    rightUrl: result?.rightUrl ?? null,
    isLoading,
    error,
    dimensions: result ? { width: result.width, height: result.height } : null,
    appliedAlignment: result?.alignment ?? null,
    sourceScale: result?.sourceScale ?? null,
  };
}

/**
 * Warms the cache for adjacent photos.
 *
 * The returned cleanup aborts the queue, so navigating past a photo stops work
 * on neighbours that are no longer adjacent instead of leaving them competing
 * with the photo the user actually landed on.
 */
export function usePreloadImages(
  photos: (ProcessablePhoto | string)[],
  album: SourceAlbum,
  options: ProcessedImageOptions = {},
): void {
  const { eyes = 'both' } = options;

  const photosRef = useRef(photos);
  photosRef.current = photos;

  const folderUrl = dropboxFolderUrl(album);
  // Keyed on stable identity rather than `src`, which for Supabase photos is a
  // freshly signed URL on every fetch and so changed on every reload.
  const photosKey = photos
    .map((p) => {
      const normalized = normalizePhoto(p);
      return normalized ? photoCacheKey(normalized, eyes) : '';
    })
    .join(',');

  useEffect(() => {
    const objects = photosRef.current
      .map(normalizePhoto)
      .filter((p): p is ProcessablePhoto => p !== null);

    if (objects.length === 0) return;

    const controller = new AbortController();
    void preloadStereoImages(objects, folderUrl, { eyes, signal: controller.signal });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photosKey, folderUrl, eyes]);
}
