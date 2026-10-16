import { alignmentRotation, alignmentScale, type StereoAlignment } from './types';

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
  /** Right-eye rotation (degrees, CCW) and scale about the crop centre, applied when drawing. */
  rotation: number;
  scale: number;
  /** Pixels trimmed from every side of both eyes so the transformed right eye has no empty corners. */
  margin: number;
}

/**
 * How much a rotation and scale about the centre pull the right eye's edges
 * inward, in source px: trimming both eyes by this keeps the frame full.
 */
export function transformMargin(cropW: number, cropH: number, rotationDeg: number, scale: number): number {
  const theta = (Math.abs(rotationDeg) * Math.PI) / 180;
  const half = Math.max(cropW, cropH) / 2;
  const fromRotation = Math.sin(theta) * half;
  const fromScale = Math.max(0, 1 - scale) * half;
  // 1e-6 absorbs float noise so 0.02 * 1000 does not ceil to 21.
  const margin = Math.ceil(fromRotation + fromScale - 1e-6);
  return margin > 0 ? margin + 1 : 0;
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

  const shiftedW = halfWidth - Math.abs(dx);
  const shiftedH = height - Math.abs(dy);

  const rotation = alignmentRotation(a);
  const scale = alignmentScale(a);
  // Both eyes lose the same border, so the pair stays registered and the
  // right eye's rotated corners never show empty.
  const wanted = transformMargin(shiftedW, shiftedH, rotation, scale);
  const margin = Math.min(wanted, Math.max(0, Math.floor((Math.min(shiftedW, shiftedH) - MIN_OVERLAP) / 2)));
  const cropW = shiftedW - 2 * margin;
  const cropH = shiftedH - 2 * margin;

  const leftHalfX = a.swapped ? halfWidth : 0;
  const rightHalfX = a.swapped ? 0 : halfWidth;

  return {
    left: { sx: leftHalfX + Math.max(0, -dx) + margin, sy: Math.max(0, -dy) + margin, sw: cropW, sh: cropH },
    right: { sx: rightHalfX + Math.max(0, dx) + margin, sy: Math.max(0, dy) + margin, sw: cropW, sh: cropH },
    cropW,
    cropH,
    dx,
    dy,
    rotation,
    scale,
    margin,
  };
}
