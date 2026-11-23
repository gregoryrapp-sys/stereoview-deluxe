import { THUMB_MAX_WIDTH, type ThumbExtension } from '@/lib/photoPaths';

/**
 * Grid thumbnails, generated in the browser.
 *
 * A grid tile is ~240-300 CSS px wide, yet every tile used to download the
 * full 2-4k side-by-side original (1-5 MB) to paint it. This produces a
 * ~1024 px wide copy of the WHOLE side-by-side image (512 px per eye, ~60-90 KB
 * as WebP) that is stored next to the original. Keeping both eyes in the thumb
 * - rather than cropping to the left eye - means the grid can show either eye
 * with CSS alone (a swapped L/R pair shows its true left eye without a
 * regeneration), and it is the same shape Dropbox's thumbnail API returns
 * during an import, so one renderer serves both producers.
 *
 * No server image library is involved anywhere in this pipeline.
 */

export interface SbsThumbnail {
  blob: Blob;
  extension: ThumbExtension;
  width: number;
  height: number;
}

const WEBP_QUALITY = 0.8;
const JPEG_QUALITY = 0.82;

type Drawable = ImageBitmap | HTMLImageElement;

interface Decoded {
  drawable: Drawable;
  width: number;
  height: number;
  release: () => void;
}

function loadImageElement(source: Blob): Promise<Decoded> {
  const url = URL.createObjectURL(source);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({
        drawable: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image'));
    };
    image.src = url;
  });
}

/**
 * createImageBitmap decodes off the main thread and applies EXIF orientation;
 * an <img> element is the fallback where it is missing or refuses the file.
 */
async function decode(source: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(source);
      return {
        drawable: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // Fall through to the element path.
    }
  }
  return loadImageElement(source);
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Scales a whole side-by-side frame to thumbnail width and encodes it (WebP, else JPEG). */
async function encodeThumbnail(drawable: CanvasImageSource, sourceWidth: number, sourceHeight: number): Promise<SbsThumbnail> {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error('Image has no dimensions');
  }

  // Never upscale: a small original gets a same-size thumb.
  const scale = Math.min(1, THUMB_MAX_WIDTH / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a canvas context');

  context.drawImage(drawable, 0, 0, width, height);

  // Browsers without a WebP encoder do not fail toBlob - they silently hand
  // back a PNG. Check the type and fall back to JPEG, and record which one
  // was written so the stored extension matches the bytes.
  let blob = await canvasToBlob(canvas, 'image/webp', WEBP_QUALITY);
  let extension: ThumbExtension = 'webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
    extension = 'jpg';
  }
  if (!blob) throw new Error('Could not encode thumbnail');

  return { blob, extension, width, height };
}

export async function makeSbsThumbnail(source: Blob): Promise<SbsThumbnail> {
  const decoded = await decode(source);
  try {
    return await encodeThumbnail(decoded.drawable, decoded.width, decoded.height);
  } finally {
    decoded.release();
  }
}

/** Seconds into a video for its poster: past a fade-in, but early. */
const POSTER_SECONDS = 1;
const POSTER_TIMEOUT_MS = 30_000;

/**
 * A side-by-side video's poster, the same shape as a photo thumbnail (both
 * eyes), from a frame about a second in. `source` is the picked File (before
 * upload) or a signed URL (background preparation); a URL is read with CORS,
 * and only the bytes up to that frame are fetched, not the whole video.
 */
export async function makeSbsVideoThumbnail(source: Blob | string): Promise<SbsThumbnail> {
  const objectUrl = typeof source === 'string' ? null : URL.createObjectURL(source);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  if (!objectUrl) video.crossOrigin = 'anonymous';

  const once = (event: string) =>
    new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Video took too long to load')), POSTER_TIMEOUT_MS);
      video.addEventListener(event, () => { window.clearTimeout(timer); resolve(); }, { once: true });
      video.addEventListener('error', () => { window.clearTimeout(timer); reject(new Error('This browser cannot read the video')); }, { once: true });
    });

  try {
    const loaded = once('loadeddata');
    video.src = objectUrl ?? (source as string);
    await loaded;
    const target = Math.min(POSTER_SECONDS, Number.isFinite(video.duration) ? video.duration / 2 : POSTER_SECONDS);
    if (target > 0) {
      const seeked = once('seeked');
      video.currentTime = target;
      await seeked;
    }
    return await encodeThumbnail(video, video.videoWidth, video.videoHeight);
  } finally {
    video.removeAttribute('src');
    video.load();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
