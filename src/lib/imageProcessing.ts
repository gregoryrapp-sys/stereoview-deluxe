/**
 * Client-side image processing for stereo photos.
 *
 * Splits a side-by-side stereo JPEG into two eyes. Three things about this
 * module are deliberate and easy to regress:
 *
 * 1. **Results are keyed on stable identity, never on `photo.src`.** Supabase
 *    photo URLs are signed and regenerated on every fetch, so keying on the URL
 *    produced a guaranteed 100% miss on every reload - in this cache, and in the
 *    browser's HTTP cache too.
 * 2. **Eyes are downscaled.** The source half is ~2166px against a viewport half
 *    of at most ~960 CSS px. Splitting at native resolution meant decoding and
 *    encoding roughly 5x more pixels than are ever displayed.
 * 3. **Encoding is asynchronous.** `canvas.toDataURL` is synchronous and blocked
 *    the main thread for hundreds of ms per eye, on the same thread the user is
 *    swiping on - and it ran for the foreground photo and both preloaded
 *    neighbours at once.
 *
 * Results are still data URLs rather than blob URLs. Blob URLs would avoid the
 * ~33% base64 overhead, but they need refcounted ownership to survive eviction
 * while a mounted <img> still points at one; that lands with the LRU rework.
 */
import { fetchDropboxFileBlob, type DropboxFile, type GalleryPhoto } from '@/services/galleryService';

export interface ProcessedStereoImage {
  leftUrl: string;
  /** Null when only the left eye was requested (portrait / 2D mode). */
  rightUrl: string | null;
  width: number;
  height: number;
}

/** Portrait/2D mode renders only the left eye, so encoding the right is pure waste. */
export type EyeSelection = 'left' | 'both';

/**
 * Longest edge of one eye after downscaling.
 *
 * The binding constraint is device pixels, not CSS pixels: a phone in landscape
 * is ~393 CSS px tall at DPR 3, so ~1179 device px, and a split eye is roughly
 * square. 1440 covers that with headroom for pinch-zoom before softness shows.
 */
const MAX_EYE_DIMENSION = 1440;
const JPEG_QUALITY = 0.85;

/** ~24 photos at roughly 0.5 MB of base64 each once downscaled. */
const MAX_CACHED_ENTRIES = 24;

/** Neighbour preloads must not starve the photo the user is actually looking at. */
const PRELOAD_CONCURRENCY = 2;

/** Insertion-ordered Map doubles as an LRU: re-inserting moves a key to the end. */
class LruCache<V> {
  private entries = new Map<string, V>();

  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

const processedImageCache = new LruCache<ProcessedStereoImage>(MAX_CACHED_ENTRIES);

/** Deduplicates concurrent requests for the same photo (preload racing the viewer). */
const inFlight = new Map<string, Promise<ProcessedStereoImage>>();

/**
 * Stable cache identity for a photo.
 *
 * `storagePath` and the row id survive a reload; `src` does not, because it is a
 * short-lived signed URL minted fresh on every gallery fetch.
 */
export function photoCacheKey(
  photo: DropboxFile | GalleryPhoto,
  eyes: EyeSelection = 'both',
): string {
  const candidate = photo as Partial<GalleryPhoto> & Partial<DropboxFile>;
  const identity = candidate.storagePath ?? candidate.id ?? candidate.path_lower ?? candidate.src;
  return `${identity}:${eyes}`;
}

/**
 * The Dropbox proxy addresses files by name within the shared folder.
 *
 * A raw `DropboxFile` carries that as `name`; once mapped into a `GalleryPhoto`
 * for display it survives as `alt`. Reading only `alt` (as this did) was a type
 * error against `DropboxFile` and relied on every caller having mapped first.
 */
function dropboxFileName(photo: DropboxFile | GalleryPhoto): string {
  const candidate = photo as Partial<DropboxFile> & Partial<GalleryPhoto>;
  return candidate.name ?? candidate.alt ?? '';
}

function loadImageFromUrl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Required so the canvas stays untainted and readable after drawing.
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    img.src = src;
  });
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The source image could not be decoded.'));
      image.src = event.target?.result as string;
    };
    reader.onerror = () => reject(new Error('The image blob could not be read.'));
    reader.readAsDataURL(blob);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to encode the processed image.'));
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Canvas encoding produced no data.'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

/**
 * Crops one eye out of the source and scales it to fit MAX_EYE_DIMENSION.
 *
 * `drawImage` does the crop and the downscale in a single GPU-accelerated pass;
 * the expensive part was never the draw, it was the encode, which is now async.
 */
async function extractEye(
  img: HTMLImageElement,
  sourceX: number,
  halfWidth: number,
  height: number,
  targetWidth: number,
  targetHeight: number,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get a 2D canvas context');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sourceX, 0, halfWidth, height, 0, 0, targetWidth, targetHeight);

  return await blobToDataUrl(await canvasToBlob(canvas));
}

async function processImage(
  photo: DropboxFile | GalleryPhoto,
  folderUrl: string | undefined,
  eyes: EyeSelection,
): Promise<ProcessedStereoImage> {
  const img = folderUrl
    // Dropbox `?raw=1` links do not serve CORS headers, so the bytes come back
    // through the edge-function proxy instead of straight into an <img>.
    ? await loadImageFromBlob(
        await fetchDropboxFileBlob({ folderUrl, fileName: dropboxFileName(photo) }),
      )
    : await loadImageFromUrl(photo.src);

  const halfWidth = Math.floor(img.width / 2);
  const height = img.height;
  if (halfWidth < 1 || height < 1) {
    throw new Error('The source image has no usable dimensions.');
  }

  const scale = Math.min(1, MAX_EYE_DIMENSION / Math.max(halfWidth, height));
  const targetWidth = Math.max(1, Math.round(halfWidth * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const leftUrl = await extractEye(img, 0, halfWidth, height, targetWidth, targetHeight);
  const rightUrl = eyes === 'both'
    ? await extractEye(img, halfWidth, halfWidth, height, targetWidth, targetHeight)
    : null;

  return { leftUrl, rightUrl, width: targetWidth, height: targetHeight };
}

/**
 * Splits a stereo image into its two eyes, cached and deduplicated.
 *
 * @param eyes `'left'` skips encoding the right eye entirely - worth roughly half
 *   the work on the portrait/2D path, which is the common case on phones.
 */
export async function splitStereoImage(
  photo: DropboxFile | GalleryPhoto, // eslint-disable-line
  folderUrl?: string,
  eyes: EyeSelection = 'both',
): Promise<ProcessedStereoImage> {
  const key = photoCacheKey(photo, eyes);

  const cached = processedImageCache.get(key);
  if (cached) return cached;

  // Without this, a preload and the foreground viewer both run the full
  // download, decode and encode for the same photo.
  const pending = inFlight.get(key);
  if (pending) return pending;

  const work = processImage(photo, folderUrl, eyes)
    .then((result) => {
      processedImageCache.set(key, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, work);
  return work;
}

/** Synchronous cache peek, so a cache hit can render without a loading flash. */
export function peekProcessedImage(
  photo: DropboxFile | GalleryPhoto,
  eyes: EyeSelection = 'both',
): ProcessedStereoImage | undefined {
  return processedImageCache.get(photoCacheKey(photo, eyes));
}

export function clearImageCache(): void {
  processedImageCache.clear();
}

/**
 * Warms the cache for adjacent photos.
 *
 * Bounded concurrency matters more than it looks: unbounded preloads competed
 * with the foreground photo for both bandwidth and main-thread time, so
 * prefetching the neighbours made the photo the user was waiting for arrive
 * later. Errors stay swallowed - a broken neighbour must not surface as a
 * viewer error - and an aborted signal stops the queue between items.
 */
export async function preloadStereoImages(
  files: (DropboxFile | GalleryPhoto)[], // eslint-disable-line
  folderUrl?: string,
  options: { eyes?: EyeSelection; signal?: AbortSignal } = {},
): Promise<void> {
  const { eyes = 'both', signal } = options;
  let cursor = 0;

  const worker = async () => {
    while (cursor < files.length) {
      if (signal?.aborted) return;
      const file = files[cursor++];
      try {
        await splitStereoImage(file, folderUrl, eyes);
      } catch {
        // Preload failures are not user-facing.
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(PRELOAD_CONCURRENCY, files.length) }, worker),
  );
}
