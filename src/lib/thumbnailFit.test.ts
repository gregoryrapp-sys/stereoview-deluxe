import { describe, expect, it } from 'vitest';
import { eyeRatioOf, fitBox } from './thumbnailFit';

describe('thumbnail fit', () => {
  it('reads one eye of a side-by-side image', () => {
    expect(eyeRatioOf({ width: 3840, height: 1080 })).toBeCloseTo(16 / 9);
    expect(eyeRatioOf({ width: 0, height: 10 })).toBeNull();
    expect(eyeRatioOf(null)).toBeNull();
  });

  it('shrinks a wide eye to the tile width, bars above and below', () => {
    expect(fitBox(2)).toEqual({ width: '100%', height: '50%' });
  });

  it('shrinks a tall eye to the tile height, bars at the sides', () => {
    expect(fitBox(0.75)).toEqual({ width: '75%', height: '100%' });
  });

  it('fills the tile until the size is known', () => {
    expect(fitBox(null)).toEqual({ width: '100%', height: '100%' });
  });
});
