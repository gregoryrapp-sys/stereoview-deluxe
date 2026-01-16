/**
 * Client-side image processing utilities for stereo photos
 * Handles splitting raw stereo images into left/right halves
 */

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
export async function splitStereoImage(src: string): Promise<ProcessedStereoImage> {
  // Check cache first
  const cached = processedImageCache.get(src);
  if (cached) {
    return cached;
  }

  const img = await loadImage(src);

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

  // Convert canvases to blob URLs
  const [leftBlob, rightBlob] = await Promise.all([
    canvasToBlob(leftCanvas),
    canvasToBlob(rightCanvas),
  ]);

  const result: ProcessedStereoImage = {
    leftUrl: URL.createObjectURL(leftBlob),
    rightUrl: URL.createObjectURL(rightBlob),
    width: halfWidth,
    height: height,
  };

  // Cache the result
  processedImageCache.set(src, result);

  return result;
}

/**
 * Convert a canvas to a Blob
 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert canvas to blob'));
        }
      },
      'image/jpeg',
      0.9 // 90% quality to match original preprocessing
    );
  });
}

/**
 * Clear the processed image cache and revoke all blob URLs
 * Call this when you want to free up memory
 */
export function clearImageCache(): void {
  processedImageCache.forEach((processed) => {
    URL.revokeObjectURL(processed.leftUrl);
    URL.revokeObjectURL(processed.rightUrl);
  });
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
export async function preloadStereoImages(srcs: string[]): Promise<void> {
  await Promise.all(srcs.map(src => splitStereoImage(src).catch(() => {})));
}
