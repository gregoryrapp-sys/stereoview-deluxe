import { describe, expect, it } from 'vitest';
import { eyeSizeFromThumb, eyeViewport, fitContain } from './viewerGeometry';

describe('fitContain', () => {
  it('letterboxes a wide image and pillarboxes a tall one', () => {
    expect(fitContain(2000, 1000, 960, 1080)).toEqual({ width: 960, height: 480, scale: 0.48 });
    expect(fitContain(1000, 2000, 960, 1080)).toEqual({ width: 540, height: 1080, scale: 0.54 });
  });

  it('upscales a small image to fill the box, as the viewer always did', () => {
    expect(fitContain(100, 100, 400, 300)?.scale).toBe(3);
  });

  it('returns null before the viewport is known', () => {
    expect(fitContain(2000, 1000, 0, 0)).toBeNull();
    expect(fitContain(0, 0, 960, 1080)).toBeNull();
  });
});

describe('eyeSizeFromThumb', () => {
  it('is half the thumbnail width at full height, so a 2:1 thumb gives a square eye', () => {
    expect(eyeSizeFromThumb(1024, 512)).toEqual({ width: 512, height: 512 });
  });

  it('matches the processed eye aspect for the common SBS shapes', () => {
    // 4128x2066 original (two 2064x2066 eyes) thumbnailed to 1024 wide.
    const thumb = eyeSizeFromThumb(1024, Math.round((2066 / 4128) * 1024));
    const processed = { width: 2064, height: 2066 };
    expect(Math.abs(thumb.width / thumb.height - processed.width / processed.height)).toBeLessThan(0.01);
  });
});

describe('eyeViewport', () => {
  it('gives each eye half the width side by side and the whole width in 2D', () => {
    expect(eyeViewport('stereo', 1920, 1080)).toEqual({ width: 960, height: 1080 });
    expect(eyeViewport('2d', 390, 844)).toEqual({ width: 390, height: 844 });
  });
});
