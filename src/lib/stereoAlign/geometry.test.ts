import { describe, expect, it } from 'vitest';
import { computeEyeRects, transformMargin, MIN_OVERLAP } from './geometry';
import { alignmentFromRow, IDENTITY_ALIGNMENT, toggleSwapped } from './types';

const W = 2000; // one eye
const H = 1500;

describe('computeEyeRects', () => {
  it('identity reads the two halves untouched', () => {
    const r = computeEyeRects(W, H, IDENTITY_ALIGNMENT);
    expect(r.left).toEqual({ sx: 0, sy: 0, sw: W, sh: H });
    expect(r.right).toEqual({ sx: W, sy: 0, sw: W, sh: H });
    expect([r.cropW, r.cropH]).toEqual([W, H]);
  });

  it('dx > 0 samples the right eye further right and crops both to the overlap', () => {
    const r = computeEyeRects(W, H, { dx: 5, dy: 0, swapped: false });
    expect(r.left.sx).toBe(0);
    expect(r.right.sx).toBe(W + 5);
    expect(r.cropW).toBe(W - 5);
    expect(r.left.sw).toBe(W - 5);
    expect(r.right.sw).toBe(W - 5);
  });

  it('dx < 0 samples the left eye further right instead', () => {
    const r = computeEyeRects(W, H, { dx: -5, dy: 0, swapped: false });
    expect(r.left.sx).toBe(5);
    expect(r.right.sx).toBe(W);
    expect(r.cropW).toBe(W - 5);
  });

  it('dy moves the right eye down for positive, the left eye down for negative', () => {
    expect(computeEyeRects(W, H, { dx: 0, dy: 3, swapped: false }).right.sy).toBe(3);
    expect(computeEyeRects(W, H, { dx: 0, dy: 3, swapped: false }).left.sy).toBe(0);
    const neg = computeEyeRects(W, H, { dx: 0, dy: -3, swapped: false });
    expect(neg.left.sy).toBe(3);
    expect(neg.right.sy).toBe(0);
    expect(neg.cropH).toBe(H - 3);
  });

  it('rectangles never leave their half', () => {
    for (const a of [
      { dx: 40, dy: 25, swapped: false },
      { dx: -40, dy: -25, swapped: false },
      { dx: 40, dy: -25, swapped: true },
    ]) {
      const r = computeEyeRects(W, H, a);
      for (const rect of [r.left, r.right]) {
        expect(rect.sx).toBeGreaterThanOrEqual(0);
        expect(rect.sy).toBeGreaterThanOrEqual(0);
        expect(rect.sx + rect.sw).toBeLessThanOrEqual(2 * W);
        expect(rect.sy + rect.sh).toBeLessThanOrEqual(H);
        // Each rect stays within a single half.
        const half = Math.floor(rect.sx / W);
        expect(Math.floor((rect.sx + rect.sw - 1) / W)).toBe(half);
      }
    }
  });

  it('swapped flips which half is displayed left', () => {
    const r = computeEyeRects(W, H, { dx: 0, dy: 0, swapped: true });
    expect(r.left.sx).toBe(W);
    expect(r.right.sx).toBe(0);
  });

  it('clamps absurd offsets so at least MIN_OVERLAP survives', () => {
    const r = computeEyeRects(W, H, { dx: 100_000, dy: -100_000, swapped: false });
    expect(r.cropW).toBe(MIN_OVERLAP);
    expect(r.cropH).toBe(MIN_OVERLAP);
    expect(r.dx).toBe(W - MIN_OVERLAP);
    expect(r.dy).toBe(-(H - MIN_OVERLAP));
  });

  it('rounds fractional offsets', () => {
    expect(computeEyeRects(W, H, { dx: 2.6, dy: -1.4, swapped: false }).dx).toBe(3);
    expect(computeEyeRects(W, H, { dx: 2.6, dy: -1.4, swapped: false }).dy).toBe(-1);
  });
});

describe('toggleSwapped', () => {
  it('negates both offsets and flips the flag; applying twice is the identity', () => {
    const a = { dx: 7, dy: -3, swapped: false };
    expect(toggleSwapped(a)).toEqual({ dx: -7, dy: 3, swapped: true });
    expect(toggleSwapped(toggleSwapped(a))).toEqual(a);
  });

  it('a toggled alignment samples the same source pixels with roles exchanged', () => {
    const a = { dx: 7, dy: -3, swapped: false };
    const r1 = computeEyeRects(W, H, a);
    const r2 = computeEyeRects(W, H, toggleSwapped(a));
    // What was the displayed-left rect becomes the displayed-right rect and vice versa.
    expect(r2.right).toEqual(r1.left);
    expect(r2.left).toEqual(r1.right);
  });
});

describe('alignmentFromRow', () => {
  it('inherits the album default when lr_swapped is null and reports nothing stored', () => {
    const { alignment, hasStored } = alignmentFromRow({}, true);
    expect(alignment).toEqual({ dx: 0, dy: 0, swapped: true });
    expect(hasStored).toBe(false);
  });

  it('a stored lr_swapped overrides the default', () => {
    const { alignment, hasStored } = alignmentFromRow({ lr_swapped: false, align_dy: 4 }, true);
    expect(alignment).toEqual({ dx: 0, dy: 4, swapped: false });
    expect(hasStored).toBe(true);
  });
});

describe('rotation and scale', () => {
  it('a pure shift trims nothing and reports identity', () => {
    const r = computeEyeRects(2000, 1000, { dx: 10, dy: -4, swapped: false });
    expect(r.margin).toBe(0);
    expect(r.rotation).toBe(0);
    expect(r.scale).toBe(1);
  });

  it('trims both eyes by the same margin for a half-degree rotation', () => {
    const r = computeEyeRects(3600, 5500, { dx: 0, dy: 0, swapped: false, rotation: 0.5 });
    // sin(0.5°) * 2750 ≈ 24 px, plus one
    expect(r.margin).toBe(transformMargin(3600, 5500, 0.5, 1));
    expect(r.margin).toBeGreaterThanOrEqual(24);
    expect(r.cropW).toBe(3600 - 2 * r.margin);
    expect(r.cropH).toBe(5500 - 2 * r.margin);
    expect(r.left.sx).toBe(r.margin);
    expect(r.right.sx).toBe(3600 + r.margin);
    expect(r.left.sy).toBe(r.margin);
  });

  it('a shrinking right eye needs a margin, a growing one does not', () => {
    expect(transformMargin(2000, 1000, 0, 0.98)).toBe(Math.ceil(0.02 * 1000) + 1);
    expect(transformMargin(2000, 1000, 0, 1.02)).toBe(0);
  });

  it('never trims below the minimum overlap', () => {
    const r = computeEyeRects(40, 40, { dx: 0, dy: 0, swapped: false, rotation: 3 });
    expect(r.cropW).toBeGreaterThanOrEqual(16);
    expect(r.cropH).toBeGreaterThanOrEqual(16);
  });
});

describe('alignmentFromRow: rotation noise floor', () => {
  it('ignores stored rotations below 0.1° and keeps real ones', async () => {
    const { alignmentFromRow } = await import('./types');
    expect(alignmentFromRow({ align_dx: 0, align_dy: 0, lr_swapped: false, align_rotation: -0.021 }, false).alignment.rotation).toBeUndefined();
    expect(alignmentFromRow({ align_dx: 0, align_dy: 0, lr_swapped: false, align_rotation: -0.556 }, false).alignment.rotation).toBe(-0.556);
  });
});
