import { useState, useEffect } from 'react';
import { splitStereoImage, ProcessedStereoImage, preloadStereoImages } from '@/lib/imageProcessing';
import type { DropboxFile, GalleryPhoto } from '@/services/galleryService';
import type { AlbumRecord } from '@/types/database';

interface UseProcessedImageResult {
  /** URL for the left half of the stereo image */
  leftUrl: string | null;
  /** URL for the right half of the stereo image */
  rightUrl: string | null;
  /** Whether the image is currently being processed */
  isLoading: boolean;
  /** Error message if processing failed */
  error: string | null;
  /** Original image dimensions (after split) */
  dimensions: { width: number; height: number } | null;
}

type ProcessablePhoto = GalleryPhoto | DropboxFile;

/**
 * Hook to process a raw stereo image into left/right halves
 * Results are cached, so subsequent calls with the same src are instant
 * @param photo The photo object (either from Supabase or Dropbox)
 * @param album The album containing the photo, used to get Dropbox context if needed
 */
export function useProcessedImage(
  photo: ProcessablePhoto | string | null,
  album: Pick<AlbumRecord, 'source_type' | 'dropbox_folder_url'> | null,
): UseProcessedImageResult {
  const [result, setResult] = useState<ProcessedStereoImage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Create a valid photo object from the input, which might be a string or an object.
    let photoObject: ProcessablePhoto | null = null;
    if (typeof photo === 'string') {
      // If a string is passed, it's a URL. We can treat it as a Supabase photo.
      photoObject = { src: photo, id: photo, alt: '' } as GalleryPhoto;
    } else if (photo && typeof photo === 'object' && photo.src) {
      // If it's a valid object, use it directly.
      photoObject = photo;
    }

    // Guard against invalid photo objects.
    if (!photoObject) {
      setIsLoading(false);
      setResult(null);
      if (photo) {
        setError('Invalid photo object provided for processing.');
      }
      return;
    }

    async function processImage() {
      setIsLoading(true);
      setError(null);
      setResult(null);

      try {
        const folderUrl = album?.source_type === 'dropbox' ? album.dropbox_folder_url ?? undefined : undefined;
        const processed = await splitStereoImage(photoObject, folderUrl);
        if (!cancelled) {
          setResult(processed);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to process image');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    processImage();

    return () => {
      cancelled = true;
    };
  }, [photo, album]);

  return {
    leftUrl: result?.leftUrl ?? null,
    rightUrl: result?.rightUrl ?? null,
    isLoading,
    error,
    dimensions: result ? { width: result.width, height: result.height } : null,
  };
}

/**
 * Hook to preload adjacent images for smoother navigation
 */
export function usePreloadImages(
  photos: (ProcessablePhoto | string)[],
  album: Pick<AlbumRecord, 'source_type' | 'dropbox_folder_url'> | null,
): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const photoSrcsKey = photos.map((p) => (typeof p === 'string' ? p : p.src)).join(',');

  useEffect(() => {
    if (photos.length > 0) {
      const photoObjects = photos
        .map((p) => {
          if (typeof p === 'string') {
            return { src: p, id: p, alt: '' } as GalleryPhoto;
          }
          return p;
        })
        .filter((p): p is ProcessablePhoto => !!(p && p.src));

      const folderUrl = album?.source_type === 'dropbox' ? album.dropbox_folder_url ?? undefined : undefined;
      preloadStereoImages(photoObjects, folderUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoSrcsKey, album]);
}
