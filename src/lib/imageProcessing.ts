/**
 * Client-side image processing utilities for stereo photos
 * Handles splitting raw stereo images into left/right halves
 */
import { fetchDropboxFileBlob, type DropboxFile, type GalleryPhoto } from '@/services/galleryService';

export interface ProcessedStereoImage {
  leftUrl: string;
  rightUrl: string;
  width: number;
  height: number;
}

// Cache for processed images to avoid reprocessing
const processedImageCache = new Map<string, ProcessedStereoImage>();

// Cache for image elements to avoid reloading
const imageElementCache = new Map<string, HTMLImageElement>();

/**
 * Load an image from a URL and return an HTMLImageElement
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  // Check cache first
  const cached = imageElementCache.get(src);
  if (cached && cached.complete) {
    return Promise.resolve(cached);
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      imageElementCache.set(src, img);
      resolve(img);
    };

    img.onerror = () => {
      reject(new Error(`Failed to load image: ${src}`));
    };

    img.src = src;
  });
}

/**
 * Split a stereo image into left and right halves
 * Returns blob URLs for each half
 */
export async function splitStereoImage(
  photo: DropboxFile | GalleryPhoto, // eslint-disable-line
  folderUrl?: string, // Optional: only for Dropbox images
): Promise<ProcessedStereoImage> {
  // Check cache first
  const cacheKey = photo.src;
  const cached = processedImageCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let img: HTMLImageElement;

  // Distinguish between Dropbox and other image sources
  if (folderUrl) {
    // It's a Dropbox file, fetch via proxy to handle CORS
    const imageBlob = await fetchDropboxFileBlob({
      folderUrl,
      fileName: photo.alt,
    });

    // Load the blob into an Image element by creating a temporary Data URL.
    // This is more robust than creating a blob: URL with createObjectURL(), which can
    // be garbage-collected by the browser during resource-intensive operations like
    // entering fullscreen, causing "Failed to load image" errors.
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('The source image could not be decoded.'));
        image.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('The image blob could not be read.'));
      reader.readAsDataURL(imageBlob);
    });
  } else {
    // It's a Supabase Storage URL (or other direct URL).
    // Use the simple and robust loadImage function which handles caching and crossOrigin.
    img = await loadImage(photo.src);
  }

  const halfWidth = Math.floor(img.width / 2);
  const height = img.height;

  // Create canvas for left half
  const leftCanvas = document.createElement('canvas');
  leftCanvas.width = halfWidth;
  leftCanvas.height = height;
  const leftCtx = leftCanvas.getContext('2d');

  if (!leftCtx) {
    throw new Error('Failed to get canvas context for left image');
  }

  leftCtx.drawImage(img, 0, 0, halfWidth, height, 0, 0, halfWidth, height);

  // Create canvas for right half
  const rightCanvas = document.createElement('canvas');
  rightCanvas.width = halfWidth;
  rightCanvas.height = height;
  const rightCtx = rightCanvas.getContext('2d');

  if (!rightCtx) {
    throw new Error('Failed to get canvas context for right image');
  }

  rightCtx.drawImage(img, halfWidth, 0, halfWidth, height, 0, 0, halfWidth, height);

  // Convert canvases to Data URLs. This is more stable than blob URLs, which can be
  // garbage collected by the browser during resource-intensive operations like
  // entering fullscreen, causing "Failed to load image" errors.
  const result: ProcessedStereoImage = {
    leftUrl: canvasToDataUrl(leftCanvas),
    rightUrl: canvasToDataUrl(rightCanvas),
    width: halfWidth,
    height: height,
  };

  // Cache the result
  processedImageCache.set(cacheKey, result);

  return result;
}

/**
 * Convert a canvas to a Data URL string.
 */
function canvasToDataUrl(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL('image/jpeg', 0.9);
}

/**
 * Clear the processed image cache.
 * Call this when you want to free up memory
 */
export function clearImageCache(): void {
  // Data URLs are strings and are garbage collected normally.
  // Unlike blob URLs, they don't need to be explicitly revoked.
  processedImageCache.clear();
  imageElementCache.clear();
}

/**
 * Get the raw image element for a stereo photo (useful for wiggle animation)
 */
export async function getStereoImageElement(src: string): Promise<HTMLImageElement> {
  return loadImage(src);
}

/**
 * Preload and process multiple stereo images
 * Useful for preloading adjacent images in a gallery
 */
export async function preloadStereoImages(
  files: (DropboxFile | GalleryPhoto)[], // eslint-disable-line
  folderUrl?: string,
): Promise<void> {
  await Promise.all(
    // Errors are ignored during preload
    files.map((file) => splitStereoImage(file, folderUrl).catch(() => {})),
  );
}
