import type { SampleLevel, SamplePyramid } from './estimator';

/**
 * Canvas glue for the estimator: turns a decoded side-by-side image into two
 * grayscale levels per eye. Runs on the main thread (canvas is not available
 * in a worker without OffscreenCanvas, which iOS lacks); the arrays it
 * produces are transferred to the worker.
 *
 * Samples the SOURCE image directly rather than the viewer's downscaled eyes,
 * so the estimate does not depend on MAX_EYE_DIMENSION.
 */

const COARSE_WIDTH = 320;
const FINE_WIDTH = 1024;

type Drawable = HTMLImageElement | ImageBitmap | HTMLCanvasElement;

function sourceSize(img: Drawable): { width: number; height: number } {
  if (img instanceof HTMLImageElement) return { width: img.naturalWidth || img.width, height: img.naturalHeight || img.height };
  return { width: img.width, height: img.height };
}

function sampleEye(
  img: Drawable,
  sx: number,
  sw: number,
  sh: number,
  targetWidth: number,
): { width: number; height: number; data: Float32Array } {
  const width = Math.min(targetWidth, sw);
  const height = Math.max(1, Math.round((sh * width) / sw));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not create a canvas context');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, 0, sw, sh, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    gray[j] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { width, height, data: gray };
}

function level(img: Drawable, halfWidth: number, height: number, swapped: boolean, targetWidth: number): SampleLevel {
  const leftX = swapped ? halfWidth : 0;
  const rightX = swapped ? 0 : halfWidth;
  const left = sampleEye(img, leftX, halfWidth, height, targetWidth);
  const right = sampleEye(img, rightX, halfWidth, height, targetWidth);
  return { width: left.width, height: left.height, left: left.data, right: right.data };
}

/**
 * Builds the two-level pyramid the estimator consumes. `swapped` decides which
 * half is treated as the displayed left, matching the alignment convention
 * that offsets are measured after the swap.
 */
export function samplePyramid(img: Drawable, swapped: boolean): SamplePyramid {
  const { width, height } = sourceSize(img);
  const halfWidth = Math.floor(width / 2);
  if (halfWidth < 2 || height < 2) throw new Error('Image is too small to sample');
  return {
    coarse: level(img, halfWidth, height, swapped, COARSE_WIDTH),
    fine: level(img, halfWidth, height, swapped, FINE_WIDTH),
    sourceHalfWidth: halfWidth,
    sourceHeight: height,
  };
}

/** The buffers to hand to postMessage as transferables. */
export function pyramidTransferables(pyramid: SamplePyramid): ArrayBuffer[] {
  return [
    pyramid.coarse.left.buffer,
    pyramid.coarse.right.buffer,
    pyramid.fine.left.buffer,
    pyramid.fine.right.buffer,
  ] as ArrayBuffer[];
}
