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
   * Scale of the right eye about its centre. Absent or 1 = none. Never set by
   * the estimator any more (the photographer wants no resampling for size) and
   * ignored when read from a row; kept so stored or in-flight values parse.
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

/** align_version value meaning "set by hand in the viewer". */
export const MANUAL_ALIGN_VERSION = 0;

/** Rotations smaller than this are sensor noise; shared by the estimator and the row reader. */
export const ROTATION_NOISE_FLOOR_DEG = 0.1;

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

/** The alignment-bearing columns of a photos row, as the API returns them. */
export interface AlignmentColumns {
  align_dx?: number | null;
  align_dy?: number | null;
  lr_swapped?: boolean | null;
  align_rotation?: number | null;
  align_scale?: number | null;
  align_version?: number | null;
  align_confidence?: number | null;
}

/**
 * Resolves a row's alignment. A null lr_swapped inherits the album default;
 * null offsets are zero. `hasStored` says whether anything was ever written,
 * which is what decides if an estimator should run later.
 */
export function alignmentFromRow(
  row: AlignmentColumns,
  albumSwappedDefault: boolean,
): { alignment: StereoAlignment; hasStored: boolean } {
  const hasStored = row.align_dx != null || row.align_dy != null || row.lr_swapped != null;
  const alignment: StereoAlignment = {
    dx: row.align_dx ?? 0,
    dy: row.align_dy ?? 0,
    swapped: row.lr_swapped ?? albumSwappedDefault,
  };
  // Below the estimator's noise floor (see MIN_ROTATION_DEG): stored by the
  // earlier 0.02° threshold, and not worth resampling the right eye for.
  if (row.align_rotation != null && Math.abs(row.align_rotation) >= ROTATION_NOISE_FLOOR_DEG) {
    alignment.rotation = row.align_rotation;
  }
  // align_scale is deliberately not read: no scaling as part of alignment.
  return { alignment, hasStored };
}
