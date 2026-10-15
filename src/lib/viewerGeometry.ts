/**
 * Pure sizing maths for the viewer stage, shared by the final eyes and the
 * loading placeholder so both land in exactly the same box.
 *
 * The placeholder is the grid thumbnail (a downscaled whole side-by-side
 * image) clipped to one half. Drawn 200% wide with `object-fit: cover`, that
 * clip is exact - no crop, no stretch - precisely when its box has the aspect
 * of half the thumbnail. Sizing the box with the same contain-fit the sharp
 * eyes use is what makes the sharp image fade in without moving.
 */

export interface StageBox {
  width: number;
  height: number;
  /** CSS px per content px; the viewer uses it to convert nudges and zoom. */
  scale: number;
}

/** Contain-fit content of size (contentW x contentH) into a box; null when any side is 0. */
export function fitContain(contentW: number, contentH: number, boxW: number, boxH: number): StageBox | null {
  if (!(contentW > 0 && contentH > 0 && boxW > 0 && boxH > 0)) return null;
  const scale = Math.min(boxW / contentW, boxH / contentH);
  return { width: contentW * scale, height: contentH * scale, scale };
}

/** One eye of a whole-SBS thumbnail is half its width at full height. */
export function eyeSizeFromThumb(thumbW: number, thumbH: number): { width: number; height: number } {
  return { width: thumbW / 2, height: thumbH };
}

/** The viewport one eye may occupy: half the width side by side, all of it in 2D. */
export function eyeViewport(
  mode: 'stereo' | '2d',
  containerW: number,
  containerH: number,
): { width: number; height: number } {
  return { width: mode === 'stereo' ? containerW / 2 : containerW, height: containerH };
}
