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
import { computeEyeRects } from '@/lib/stereoAlign/geometry';
import { IDENTITY_ALIGNMENT, type StereoAlignment } from '@/lib/stereoAlign/types';
import { clearPersistedEyes, persistEyes, readPersistedEyes, scheduleReconcile } from '@/lib/eyeStore';

export interface ProcessedStereoImage {
  leftUrl: string;
  /** Null when only the left eye was requested (portrait / 2D mode). */
  rightUrl: string | null;
  width: number;
  height: number;
  /** The alignment that was applied when splitting (after clamping). */
  alignment: StereoAlignment;
  /** Output px per SOURCE px of one eye; the viewer needs it to preview nudges in CSS. */
  sourceScale: number;
}

/** Portrait/2D mode renders only the left eye, so encoding the right is pure waste. */
export type EyeSelection = 'left' | 'both';

/**
 * Size tier of the split eyes. `fit` covers the screen at 1x with headroom;
 * `zoom` is requested once the viewer is pinched past that headroom and goes
 * up to the source resolution (within a cap), so zoomed-in detail is real
 * detail rather than an upscale of the fit tier.
 */
export type EyeTier = 'fit' | 'zoom';
/** A phone's canvas is limited to about 16 MP (4096x4096); desktops take more. */
const ZOOM_EYE_DIMENSION_PHONE = 4096;
const ZOOM_EYE_DIMENSION_DESKTOP = 6144;
/** The viewer asks for the zoom tier past this pinch scale (fit has 1.25x headroom). */
export const ZOOM_TIER_MIN_SCALE = 1.3;

/**
 * Longest edge of one eye after downscaling, sized to the screen it will be
 * shown on.
 *
 * The binding constraint is device pixels, not CSS pixels. A fixed 1440 was
 * chosen for a phone in landscape (~393 CSS px tall at DPR 3), but a desktop
 * at DPR 2 shows an eye across 2160 device pixels in 2D mode and more under
 * pinch-zoom, so a 3600x5498 eye was shrunk to 943x1440 and stretched back
 * up: visibly softer than the same file opened in Dropbox. The eye now fits
 * the screen's long edge in device pixels with headroom for a modest zoom,
 * never above the source, and never above MAX_EYE_DIMENSION_CAP, which keeps
 * canvas and cache memory bounded on large displays.
 */
export const MIN_EYE_DIMENSION = 1440;
export const MAX_EYE_DIMENSION_CAP = 4096;
/** Pinch-zoom starts to soften past this factor; full 5x is accepted as soft. */
const ZOOM_HEADROOM = 1.25;
/** Downscaled eyes are the only copy the viewer has; spend a little more on them. */
const JPEG_QUALITY = 0.92;

/** Pure form for tests: screen long edge in CSS px and the device pixel ratio. */
export function maxEyeDimensionFor(screenLongEdgeCss: number, devicePixelRatio: number): number {
  const dpr = Math.min(Math.max(devicePixelRatio || 1, 1), 3);
  const wanted = Math.ceil(screenLongEdgeCss * dpr * ZOOM_HEADROOM);
  return Math.min(MAX_EYE_DIMENSION_CAP, Math.max(MIN_EYE_DIMENSION, wanted));
}

function screenLongEdgeCss(): number {
  if (typeof window === 'undefined') return 0;
  return Math.max(window.screen?.width ?? 0, window.screen?.height ?? 0, window.innerWidth, window.innerHeight);
}

export function maxEyeDimension(tier: EyeTier = 'fit'): number {
  if (typeof window === 'undefined') return MIN_EYE_DIMENSION;
  const fit = maxEyeDimensionFor(screenLongEdgeCss(), window.devicePixelRatio);
  if (tier === 'fit') return fit;
  const zoomCap = screenLongEdgeCss() < 1000 ? ZOOM_EYE_DIMENSION_PHONE : ZOOM_EYE_DIMENSION_DESKTOP;
  return Math.max(fit, zoomCap);
}

/** Quality tier identity for cache keys, device-aware so a phone's eyes never serve a desktop. */
export function eyeTierKey(tier: EyeTier): string {
  return `${tier}${maxEyeDimension(tier)}`;
}

/** ~24 photos at 0.5-2 MB of base64 each once downscaled (phone to 4K). */
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
/** Zoom-tier eyes are several MB each; keep only a few in memory. */
const zoomImageCache = new LruCache<ProcessedStereoImage>(4);
const cacheFor = (tier: EyeTier) => (tier === 'zoom' ? zoomImageCache : processedImageCache);

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
  alignment: StereoAlignment = resolveAlignment(photo),
  tier: EyeTier = 'fit',
): string {
  const candidate = photo as Partial<GalleryPhoto> & Partial<DropboxFile>;
  const identity = candidate.storagePath ?? candidate.id ?? candidate.path_lower ?? candidate.src;
  // Alignment is part of the identity: the same photo split with a different
  // offset or swap is a different pair of eyes.
  const rotation = alignment.rotation ?? 0;
  const scale = alignment.scale ?? 1;
  const transform = rotation !== 0 || scale !== 1 ? `:${rotation.toFixed(3)}:${scale.toFixed(4)}` : '';
  const tierPart = tier === 'zoom' ? ':zoom' : '';
  return `${identity}:${eyes}:${alignment.swapped ? 1 : 0}:${alignment.dx}:${alignment.dy}${transform}${tierPart}`;
}

/**
 * The alignment to split with when the caller gives none: what the photo row
 * carries (already resolved against the album default by the service), else
 * identity. A raw DropboxFile has none.
 */
export function resolveAlignment(photo: DropboxFile | GalleryPhoto): StereoAlignment {
  return (photo as Partial<GalleryPhoto>).alignment ?? IDENTITY_ALIGNMENT;
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
 * Crops one eye out of the source and scales it to fit maxEyeDimension().
 *
 * `drawImage` does the crop and the downscale in a single GPU-accelerated pass;
 * the expensive part was never the draw, it was the encode, which is now async.
 */
async function extractEye(
  img: HTMLImageElement,
  rect: { sx: number; sy: number; sw: number; sh: number },
  targetWidth: number,
  targetHeight: number,
  transform?: { rotation: number; scale: number },
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get a 2D canvas context');

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // The source rectangle carries the shift: the right eye's rect is moved by
  // (dx, dy) and both are cropped to the overlap plus a margin (see
  // stereoAlign/geometry). Rotation and scale are the model's s·R(θ) about the
  // eye centre: output pixel p must show source pixel s·R(θ)·(p - c) + c, so the
  // canvas is set up with the inverse, R(-θ)/s about the output centre.
  if (transform && (transform.rotation !== 0 || transform.scale !== 1)) {
    const cx = targetWidth / 2, cy = targetHeight / 2;
    ctx.translate(cx, cy);
    ctx.rotate((-transform.rotation * Math.PI) / 180);
    ctx.scale(1 / transform.scale, 1 / transform.scale);
    ctx.translate(-cx, -cy);
  }
  ctx.drawImage(img, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, targetWidth, targetHeight);

  const blob = await canvasToBlob(canvas);
  canvas.width = 0;
  canvas.height = 0;
  return blob;
}

/** Split eyes as blobs plus the numbers the viewer needs; data URLs are made from this. */
interface SplitBlobs {
  left: Blob;
  right: Blob | null;
  width: number;
  height: number;
  alignment: StereoAlignment;
  sourceScale: number;
}

async function toProcessed(split: SplitBlobs): Promise<ProcessedStereoImage> {
  // Data URLs in memory, as before: no revocation to get wrong while an
  // <img> still points at one. Object URLs with ownership are a later change.
  const [leftUrl, rightUrl] = await Promise.all([
    blobToDataUrl(split.left),
    split.right ? blobToDataUrl(split.right) : Promise.resolve(null),
  ]);
  return { leftUrl, rightUrl, width: split.width, height: split.height, alignment: split.alignment, sourceScale: split.sourceScale };
}

/** A few decoded originals, so Auto-align in the viewer does not re-download the photo just split. */
const sourceImageCache = new LruCache<HTMLImageElement>(3);

/**
 * The decoded side-by-side source for a photo. Shared by the split and by the
 * alignment estimator, which samples the source rather than the split eyes.
 */
export async function loadStereoSourceImage(
  photo: DropboxFile | GalleryPhoto,
  folderUrl?: string,
): Promise<HTMLImageElement> {
  const identity = photoCacheKey(photo, 'both', IDENTITY_ALIGNMENT);
  const cached = sourceImageCache.get(identity);
  if (cached) return cached;

  const img = folderUrl
    // Dropbox `?raw=1` links do not serve CORS headers, so the bytes come back
    // through the edge-function proxy instead of straight into an <img>.
    ? await loadImageFromBlob(
        await fetchDropboxFileBlob({ folderUrl, fileName: dropboxFileName(photo) }),
      )
    : await loadImageFromUrl(photo.src);

  sourceImageCache.set(identity, img);
  return img;
}

async function processImage(
  photo: DropboxFile | GalleryPhoto,
  folderUrl: string | undefined,
  eyes: EyeSelection,
  alignment: StereoAlignment,
  tier: EyeTier,
): Promise<SplitBlobs> {
  const img = await loadStereoSourceImage(photo, folderUrl);

  const halfWidth = Math.floor(img.width / 2);
  const height = img.height;
  if (halfWidth < 1 || height < 1) {
    throw new Error('The source image has no usable dimensions.');
  }

  const rects = computeEyeRects(halfWidth, height, alignment);

  const scale = Math.min(1, maxEyeDimension(tier) / Math.max(rects.cropW, rects.cropH));
  const targetWidth = Math.max(1, Math.round(rects.cropW * scale));
  const targetHeight = Math.max(1, Math.round(rects.cropH * scale));

  // 2D mode shows the displayed-left eye, which after `swapped` may be the
  // right half of the file - so the crop and the swap apply here too.
  const left = await extractEye(img, rects.left, targetWidth, targetHeight);
  const right = eyes === 'both'
    ? await extractEye(img, rects.right, targetWidth, targetHeight, { rotation: rects.rotation, scale: rects.scale })
    : null;

  const applied: StereoAlignment = { dx: rects.dx, dy: rects.dy, swapped: alignment.swapped };
  if (rects.rotation !== 0) applied.rotation = rects.rotation;
  if (rects.scale !== 1) applied.scale = rects.scale;

  return {
    left,
    right,
    width: targetWidth,
    height: targetHeight,
    alignment: applied,
    sourceScale: targetWidth / rects.cropW,
  };
}

/** Key under which both eyes of a photo are persisted, independent of which eyes were requested. */
function persistKey(photo: DropboxFile | GalleryPhoto, alignment: StereoAlignment): string {
  return photoCacheKey(photo, 'both', alignment);
}

let reconcileScheduled = false;

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
  options: { alignment?: StereoAlignment; tier?: EyeTier } = {},
): Promise<ProcessedStereoImage> {
  const alignment = options.alignment ?? resolveAlignment(photo);
  const tier = options.tier ?? 'fit';
  const key = photoCacheKey(photo, eyes, alignment, tier);
  const memory = cacheFor(tier);

  const cached = memory.get(key);
  if (cached) return cached;

  // Without this, a preload and the foreground viewer both run the full
  // download, decode and encode for the same photo.
  const pending = inFlight.get(key);
  if (pending) return pending;

  if (!reconcileScheduled) {
    reconcileScheduled = true;
    scheduleReconcile();
  }

  const stored = persistKey(photo, alignment);
  const tierKey = eyeTierKey(tier);

  const work = (async () => {
    // Persisted from an earlier visit: no download, no split.
    const persisted = await readPersistedEyes(stored, tierKey, eyes);
    if (persisted) {
      const { meta } = persisted;
      const appliedAlignment: StereoAlignment = { dx: meta.dx, dy: meta.dy, swapped: meta.swapped };
      if (meta.rotation) appliedAlignment.rotation = meta.rotation;
      if (meta.scale) appliedAlignment.scale = meta.scale;
      return toProcessed({
        left: persisted.left,
        right: persisted.right,
        width: meta.width,
        height: meta.height,
        alignment: appliedAlignment,
        sourceScale: meta.sourceScale,
      });
    }

    const split = await processImage(photo, folderUrl, eyes, alignment, tier);
    const result = await toProcessed(split);
    // Store after answering; the viewer never waits for the write.
    void persistEyes(stored, tierKey, split.left, split.right, {
      width: split.width,
      height: split.height,
      sourceScale: split.sourceScale,
      dx: split.alignment.dx,
      dy: split.alignment.dy,
      swapped: split.alignment.swapped,
      rotation: split.alignment.rotation,
      scale: split.alignment.scale,
    });
    return result;
  })()
    .then((result) => {
      memory.set(key, result);
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
  alignment: StereoAlignment = resolveAlignment(photo),
  tier: EyeTier = 'fit',
): ProcessedStereoImage | undefined {
  return cacheFor(tier).get(photoCacheKey(photo, eyes, alignment, tier));
}

/** Memory and the on-device store. Called on sign-out: galleries are PIN-protected. */
export function clearImageCache(): void {
  processedImageCache.clear();
  zoomImageCache.clear();
  sourceImageCache.clear();
  void clearPersistedEyes();
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
