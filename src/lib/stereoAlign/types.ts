/**
 * Stereo alignment metadata.
 *
 * CONVENTION - everything else derives from these two sentences:
 *
 *   Offsets are in SOURCE pixels of one eye and are measured AFTER `swapped`
 *   has been applied (i.e. after deciding which half is the displayed left).
 *
 *   Matching content satisfies  L(x, y) ≈ R(x + dx, y + dy).
 *
 * Equivalently, the right eye's `drawImage` source rectangle is shifted by
 * (+dx, +dy) and both eyes are cropped to the overlap. Pixels are never
 * rewritten; alignment is metadata applied at view time.
 */
export interface StereoAlignment {
  dx: number;
  dy: number;
  /** The pair is stored right-eye-first; display the halves the other way round. */
  swapped: boolean;
  /**
   * Rotation of the right eye about its centre, degrees, counter-clockwise
   * positive, applied before the (dx, dy) shift. Absent or 0 = none. Stereo
   * rigs whose two cameras are not perfectly level produce a fraction of a
   * degree here, which no shift can correct.
   */
  rotation?: number;
  /**
   * Scale of the right eye about its centre. Absent or 1 = none. Nothing sets
   * it now; the split still honours it so the geometry stays general.
   */
  scale?: number;
}

export function alignmentRotation(a: StereoAlignment): number {
  return a.rotation ?? 0;
}

export function alignmentScale(a: StereoAlignment): number {
  return a.scale ?? 1;
}

/** True when rotation and scale are both at identity (within float noise). */
export function isPureShift(a: StereoAlignment): boolean {
  return Math.abs(alignmentRotation(a)) < 1e-6 && Math.abs(alignmentScale(a) - 1) < 1e-6;
}

export const IDENTITY_ALIGNMENT: StereoAlignment = { dx: 0, dy: 0, swapped: false };

export function isIdentityAlignment(a: StereoAlignment): boolean {
  return a.dx === 0 && a.dy === 0 && !a.swapped && isPureShift(a);
}

export function alignmentsEqual(a: StereoAlignment, b: StereoAlignment): boolean {
  return (
    a.dx === b.dx &&
    a.dy === b.dy &&
    a.swapped === b.swapped &&
    Math.abs(alignmentRotation(a) - alignmentRotation(b)) < 1e-6 &&
    Math.abs(alignmentScale(a) - alignmentScale(b)) < 1e-6
  );
}

/**
 * Toggling which half is "left" inverts the roles of the two halves, so the
 * offsets measured from the old left to the old right become their negatives.
 */
export function toggleSwapped(a: StereoAlignment): StereoAlignment {
  // The model maps a left-eye point p (relative to the eye centre) to the
  // right-eye point q = s·R(θ)·p + t. Exchanging the eyes needs the inverse,
  // p = (1/s)·R(-θ)·q - (1/s)·R(-θ)·t: rotation and scale invert, and the shift
  // is the inverse-transformed negative, which for a pure shift is (-dx, -dy).
  const theta = (alignmentRotation(a) * Math.PI) / 180;
  const s = alignmentScale(a);
  const cos = Math.cos(-theta), sin = Math.sin(-theta);
  const dx = -(cos * a.dx - sin * a.dy) / s;
  const dy = -(sin * a.dx + cos * a.dy) / s;
  const out: StereoAlignment = { dx: Math.round(dx), dy: Math.round(dy), swapped: !a.swapped };
  if (!isPureShift(a)) {
    out.rotation = -alignmentRotation(a);
    out.scale = 1 / s;
  }
  return out;
}

/**
 * How a photo is split for display. There is no per-photo alignment any more
 * (auto-align was removed and its stored values cleared): only the album's
 * "camera writes right-eye first" setting decides which half is the left eye.
 */
export function albumAlignment(albumSwappedDefault: boolean): StereoAlignment {
  return { dx: 0, dy: 0, swapped: albumSwappedDefault };
}
