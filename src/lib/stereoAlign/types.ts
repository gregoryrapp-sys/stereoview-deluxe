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
}

export const IDENTITY_ALIGNMENT: StereoAlignment = { dx: 0, dy: 0, swapped: false };

/** align_version value meaning "set by hand in the viewer". */
export const MANUAL_ALIGN_VERSION = 0;

export function isIdentityAlignment(a: StereoAlignment): boolean {
  return a.dx === 0 && a.dy === 0 && !a.swapped;
}

export function alignmentsEqual(a: StereoAlignment, b: StereoAlignment): boolean {
  return a.dx === b.dx && a.dy === b.dy && a.swapped === b.swapped;
}

/**
 * Toggling which half is "left" inverts the roles of the two halves, so the
 * offsets measured from the old left to the old right become their negatives.
 */
export function toggleSwapped(a: StereoAlignment): StereoAlignment {
  return { dx: -a.dx, dy: -a.dy, swapped: !a.swapped };
}

/** The alignment-bearing columns of a photos row, as the API returns them. */
export interface AlignmentColumns {
  align_dx?: number | null;
  align_dy?: number | null;
  lr_swapped?: boolean | null;
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
  return {
    alignment: {
      dx: row.align_dx ?? 0,
      dy: row.align_dy ?? 0,
      swapped: row.lr_swapped ?? albumSwappedDefault,
    },
    hasStored,
  };
}
