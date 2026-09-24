import type { AlignmentEstimate } from './estimator';
import { estimateInWorker } from './alignClient';
import { samplePyramid } from './sampler';
import { type StereoAlignment, toggleSwapped } from './types';

/** Below this the estimate is noise and must not be stored. */
export const STORE_MIN_CONFIDENCE = 0.5;

/**
 * Turns an estimate into the alignment to store, applying the L/R verdict.
 *
 * `swapSuggested` already encodes the photographer's script rule (background
 * registered, foreground parallax >= 1.5 px, >= 80% agreement); when it is set
 * the halves are exchanged and, per the convention in types.ts, the measured
 * offsets are negated because they were measured in the old order. When the
 * detector is unsure nothing is flipped - landscapes and distant scenes are
 * usually uploaded correctly, and a wrong flip is worse than none.
 */
export function applyEstimate(est: AlignmentEstimate, displayedSwapped: boolean): StereoAlignment {
  const measured: StereoAlignment = { dx: est.alignment.dx, dy: est.alignment.dy, swapped: displayedSwapped };
  return est.swapSuggested ? toggleSwapped(measured) : measured;
}
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
