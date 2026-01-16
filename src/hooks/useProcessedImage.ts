import { useState, useEffect } from 'react';
import { splitStereoImage, ProcessedStereoImage, preloadStereoImages } from '@/lib/imageProcessing';

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

/**
 * Hook to process a raw stereo image into left/right halves
 * Results are cached, so subsequent calls with the same src are instant
 */
export function useProcessedImage(src: string): UseProcessedImageResult {
  const [result, setResult] = useState<ProcessedStereoImage | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function processImage() {
      setIsLoading(true);
      setError(null);

      try {
        const processed = await splitStereoImage(src);
        if (!cancelled) {
          setResult(processed);
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to process image');
          setIsLoading(false);
        }
      }
    }

    processImage();

    return () => {
      cancelled = true;
    };
  }, [src]);

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
export function usePreloadImages(srcs: string[]): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const srcsKey = srcs.join(',');

  useEffect(() => {
    if (srcs.length > 0) {
      preloadStereoImages(srcs);
    }
  }, [srcsKey]); // eslint-disable-line react-hooks/exhaustive-deps
}
