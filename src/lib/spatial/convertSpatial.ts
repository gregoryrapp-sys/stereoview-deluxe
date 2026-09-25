import type { SpatialInfo } from './decodeSpatial';
import { decodeSpatialFile } from './spatialClient';

/**
 * Turns an Apple Spatial Photo into the side-by-side JPEG the rest of the app
 * already understands: left eye on the left, right eye on the right, same
 * height. From here it is an ordinary upload - thumbnail, auto-alignment,
 * storage - and the viewer never learns where it came from.
 */

/** Visually lossless for photos; a 12 MP pair lands around 6-8 MB, like the originals we store today. */
const JPEG_QUALITY = 0.92;

export interface SpatialConversion {
  file: File;
  width: number;
  height: number;
  info: SpatialInfo;
  ms: number;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function convertSpatialToSbs(source: File): Promise<SpatialConversion> {
  const started = performance.now();
  const eyes = await decodeSpatialFile(source);

  // Both eyes normally match exactly; crop to the smaller one if they ever differ.
  const width = Math.min(eyes.left.width, eyes.right.width);
  const height = Math.min(eyes.left.height, eyes.right.height);

  const canvas = document.createElement('canvas');
  canvas.width = width * 2;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a canvas to compose the side-by-side image');

  // putImageData clips to the canvas, so an oversized eye is cropped rather than scaled.
  ctx.putImageData(new ImageData(eyes.left.rgba, eyes.left.width, eyes.left.height), 0, 0);
  ctx.putImageData(new ImageData(eyes.right.rgba, eyes.right.width, eyes.right.height), width, 0);

  const blob = await canvasToBlob(canvas, 'image/jpeg', JPEG_QUALITY);
  canvas.width = 0;
  canvas.height = 0;
  if (!blob) throw new Error('Could not encode the side-by-side JPEG');

  const name = source.name.replace(/\.[^.]+$/, '') + '.jpg';
  const file = new File([blob], name, { type: 'image/jpeg', lastModified: source.lastModified });
  return { file, width: width * 2, height, info: eyes.info, ms: performance.now() - started };
}
