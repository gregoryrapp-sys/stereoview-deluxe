import type { StereoAlignment } from './types';

/** Never crop an eye below this many pixels in either axis. */
export const MIN_OVERLAP = 16;

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface EyeRects {
  left: SourceRect;
  right: SourceRect;
  /** Output size shared by both eyes: the overlap after shifting. */
  cropW: number;
  cropH: number;
  /** The offsets actually applied, after clamping. */
  dx: number;
  dy: number;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/**
 * Where to read each eye from a side-by-side image of width 2*halfWidth.
 *
 * With L(x,y) ≈ R(x+dx, y+dy): the right eye's rectangle starts dx further
 * right (dy further down) than the left's, and both shrink to the overlap so
 * neither eye shows a black bar. Concretely, for dx > 0 the left rect starts
 * at 0 and the right rect at halfWidth + dx; for dx < 0 the left rect starts at
 * -dx and the right at halfWidth. Same for dy. Both rectangles are fully
 * inside their halves by construction.
 *
 * `swapped` decides which half is the DISPLAYED left. Offsets are measured
 * after that decision (see types.ts), so they are applied unchanged.
 */
export function computeEyeRects(halfWidth: number, height: number, a: StereoAlignment): EyeRects {
  const maxDx = Math.max(0, halfWidth - MIN_OVERLAP);
  const maxDy = Math.max(0, height - MIN_OVERLAP);
  const dx = clampInt(a.dx, -maxDx, maxDx);
  const dy = clampInt(a.dy, -maxDy, maxDy);

  const cropW = halfWidth - Math.abs(dx);
  const cropH = height - Math.abs(dy);

  const leftHalfX = a.swapped ? halfWidth : 0;
  const rightHalfX = a.swapped ? 0 : halfWidth;

  return {
    left: { sx: leftHalfX + Math.max(0, -dx), sy: Math.max(0, -dy), sw: cropW, sh: cropH },
    right: { sx: rightHalfX + Math.max(0, dx), sy: Math.max(0, dy), sw: cropW, sh: cropH },
    cropW,
    cropH,
    dx,
    dy,
  };
}
