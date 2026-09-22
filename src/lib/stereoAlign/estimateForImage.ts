import type { AlignmentEstimate } from './estimator';
import { estimateInWorker } from './alignClient';
import { samplePyramid } from './sampler';

/** Below this the estimate is noise and must not be stored. */
export const STORE_MIN_CONFIDENCE = 0.5;
/** At or above this an owner's viewer may persist silently. */
export const AUTO_PERSIST_MIN_CONFIDENCE = 0.7;

/**
 * Estimates the alignment of a decoded side-by-side image.
 *
 * `swapped` is the order to measure in (the album default or the photo's own
 * setting); the estimate's `alignment.swapped` echoes it, and `swapSuggested`
 * says whether the depth ordering looks inverted relative to that.
 */
export async function estimateImageAlignment(
  img: HTMLImageElement | ImageBitmap,
  options: { swapped?: boolean } = {},
): Promise<AlignmentEstimate> {
  const swapped = options.swapped ?? false;
  const pyramid = samplePyramid(img, swapped);
  return estimateInWorker(pyramid, swapped);
}

/** Decodes a File/Blob and estimates it; used at upload time. */
export async function estimateFileAlignment(
  source: Blob,
  options: { swapped?: boolean } = {},
): Promise<AlignmentEstimate> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(source);
    try {
      return await estimateImageAlignment(bitmap, options);
    } finally {
      bitmap.close();
    }
  }
  const url = URL.createObjectURL(source);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Could not decode image'));
      el.src = url;
    });
    return await estimateImageAlignment(img, options);
  } finally {
    URL.revokeObjectURL(url);
  }
}
