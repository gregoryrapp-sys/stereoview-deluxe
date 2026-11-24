/** Fitting one eye of a side-by-side image, uncropped, into a square tile. */

/** One eye's width / height for a side-by-side image of this size. */
export function eyeRatioOf(size: { width: number; height: number } | null): number | null {
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return size.width / 2 / size.height;
}

/**
 * The eye's box inside a square tile: as large as fits, keeping its ratio.
 * Unknown ratio: fill the tile until the image says otherwise.
 */
export function fitBox(ratio: number | null): { width: string; height: string } {
  if (!ratio) return { width: '100%', height: '100%' };
  return ratio >= 1
    ? { width: '100%', height: `${100 / ratio}%` }
    : { width: `${ratio * 100}%`, height: '100%' };
}
