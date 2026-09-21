import { describe, expect, it } from 'vitest';
import { computeEyeRects, MIN_OVERLAP } from './geometry';
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
