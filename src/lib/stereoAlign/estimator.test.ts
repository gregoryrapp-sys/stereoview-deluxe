import { describe, expect, it } from 'vitest';
import { estimateAlignment, type GrayImage, type SamplePyramid } from './estimator';

/**
 * Synthetic pairs only - jsdom has no canvas and these tests must not need one.
 * The texture is seeded noise blurred a little plus a few rectangles, then the
 * right eye is produced by SHIFTING the left, so the ground truth is exact.
 */

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function makeTexture(width: number, height: number, seed = 7): GrayImage {
  const rnd = lcg(seed);
  const raw = new Float32Array(width * height);
  for (let i = 0; i < raw.length; i++) raw[i] = rnd() * 255;
  // Light blur so the texture has structure at several scales.
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && yy < height && xx >= 0 && xx < width) { acc += raw[yy * width + xx]; n++; }
      }
      data[y * width + x] = acc / n;
    }
  }
  // A few rectangles for larger-scale features.
  for (let k = 0; k < 6; k++) {
    const rx = Math.floor(rnd() * (width - 40)), ry = Math.floor(rnd() * (height - 30));
    const rw = 20 + Math.floor(rnd() * 40), rh = 15 + Math.floor(rnd() * 30);
    const v = rnd() * 255;
    for (let y = ry; y < Math.min(height, ry + rh); y++) for (let x = rx; x < Math.min(width, rx + rw); x++) data[y * width + x] = 0.5 * data[y * width + x] + 0.5 * v;
  }
  return { width, height, data };
}

/** right(x, y) = left(x + dx, y + dy), i.e. L(x,y) ≈ R(x - dx, y - dy)... careful: we
 *  build R so that L(x,y) ≈ R(x + dx, y + dy) => R(u, v) = L(u - dx, v - dy). */
function shifted(left: GrayImage, dx: number, dy: number, gain = 1, bias = 0): Float32Array {
  const out = new Float32Array(left.width * left.height);
  for (let v = 0; v < left.height; v++) {
    for (let u = 0; u < left.width; u++) {
      const x = u - dx, y = v - dy;
      const inside = x >= 0 && x < left.width && y >= 0 && y < left.height;
      out[v * left.width + u] = inside ? left.data[y * left.width + x] * gain + bias : 128;
    }
  }
  return out;
}

/** Area-averaging downsample - what the canvas sampler does with smoothing on. */
function downsampleTo(img: GrayImage, targetWidth: number): GrayImage {
  const factor = img.width / targetWidth;
  const width = targetWidth;
  const height = Math.round(img.height / factor);
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.floor(x * factor), x1 = Math.max(x0 + 1, Math.floor((x + 1) * factor));
    const y0 = Math.floor(y * factor), y1 = Math.max(y0 + 1, Math.floor((y + 1) * factor));
    let acc = 0, n = 0;
    for (let sy = y0; sy < Math.min(y1, img.height); sy++) for (let sx = x0; sx < Math.min(x1, img.width); sx++) { acc += img.data[sy * img.width + sx]; n++; }
    data[y * width + x] = n ? acc / n : 0;
  }
  return { width, height, data };
}

/** Builds a pyramid from a full-resolution synthetic eye pair. */
function pyramidFrom(leftFull: GrayImage, rightFull: Float32Array): SamplePyramid {
  const rightImg = { width: leftFull.width, height: leftFull.height, data: rightFull };
  const coarseL = downsampleTo(leftFull, 320), coarseR = downsampleTo(rightImg, 320);
  const fineL = downsampleTo(leftFull, 1024), fineR = downsampleTo(rightImg, 1024);
  return {
    coarse: { width: coarseL.width, height: coarseL.height, left: coarseL.data, right: coarseR.data },
    fine: { width: fineL.width, height: fineL.height, left: fineL.data, right: fineR.data },
    sourceHalfWidth: leftFull.width,
    sourceHeight: leftFull.height,
  };
}

const SRC_W = 1024; // keep tests fast: "source" is 1024 px per eye
const SRC_H = 768;

describe('estimateAlignment', () => {
  it('recovers a pure vertical offset within 1 px', () => {
    const left = makeTexture(SRC_W, SRC_H);
    for (const dy of [0, 4, -7, 11]) {
      const est = estimateAlignment(pyramidFrom(left, shifted(left, 0, dy)));
      expect(Math.abs(est.alignment.dy - dy)).toBeLessThanOrEqual(1);
      expect(est.confidence).toBeGreaterThan(0.5);
      expect(est.rotationSuspected).toBe(false);
    }
  });

  it('recovers dy in the presence of a global horizontal shift and reports it as disparity', () => {
    const left = makeTexture(SRC_W, SRC_H, 3);
    const est = estimateAlignment(pyramidFrom(left, shifted(left, 12, -5)));
    expect(Math.abs(est.alignment.dy - -5)).toBeLessThanOrEqual(1);
    expect(est.alignment.dx).toBe(0); // dx is policy, not measurement
    expect(Math.abs(est.disparity.median - 12)).toBeLessThanOrEqual(2);
  });

  it('is robust to gain and bias differences between the eyes', () => {
    const left = makeTexture(SRC_W, SRC_H, 11);
    const est = estimateAlignment(pyramidFrom(left, shifted(left, 0, 6, 0.8, 20)));
    expect(Math.abs(est.alignment.dy - 6)).toBeLessThanOrEqual(1);
  });

  it('returns low confidence and no suggestion for a flat image', () => {
    const flat: GrayImage = { width: SRC_W, height: SRC_H, data: new Float32Array(SRC_W * SRC_H).fill(128) };
    const rnd = lcg(5);
    for (let i = 0; i < flat.data.length; i += 97) flat.data[i] += rnd() * 0.5;
    const est = estimateAlignment(pyramidFrom(flat, shifted(flat, 0, 3)));
    expect(est.confidence).toBeLessThan(0.3);
    expect(est.swapSuggested).toBe(false);
  });

  it('does not suggest a swap for a layered scene with near content at the bottom', () => {
    // Correct order: nearer (bottom) content has MORE NEGATIVE dx.
    const left = makeTexture(SRC_W, SRC_H, 21);
    const right = new Float32Array(SRC_W * SRC_H);
    const bands = [{ from: 0, to: SRC_H / 3, dx: 0 }, { from: SRC_H / 3, to: (2 * SRC_H) / 3, dx: -8 }, { from: (2 * SRC_H) / 3, to: SRC_H, dx: -18 }];
    for (const band of bands) {
      const s = shifted(left, band.dx, 0);
      for (let y = Math.floor(band.from); y < Math.floor(band.to); y++) right.set(s.subarray(y * SRC_W, (y + 1) * SRC_W), y * SRC_W);
    }
    const est = estimateAlignment(pyramidFrom(left, right));
    expect(est.swapSuggested).toBe(false);
    expect(Math.abs(est.alignment.dy)).toBeLessThanOrEqual(1);
  });

  it('suggests a swap when the depth ordering is inverted', () => {
    // Swapped: nearer (bottom) content has MORE POSITIVE dx.
    const left = makeTexture(SRC_W, SRC_H, 23);
    const right = new Float32Array(SRC_W * SRC_H);
    const bands = [{ from: 0, to: SRC_H / 3, dx: 0 }, { from: SRC_H / 3, to: (2 * SRC_H) / 3, dx: 8 }, { from: (2 * SRC_H) / 3, to: SRC_H, dx: 18 }];
    for (const band of bands) {
      const s = shifted(left, band.dx, 0);
      for (let y = Math.floor(band.from); y < Math.floor(band.to); y++) right.set(s.subarray(y * SRC_W, (y + 1) * SRC_W), y * SRC_W);
    }
    const est = estimateAlignment(pyramidFrom(left, right));
    expect(est.swapSuggested).toBe(true);
    expect(est.swapConfidence).toBeGreaterThan(0.5);
  });

  it('flags rotation when dy drifts across the frame', () => {
    const left = makeTexture(SRC_W, SRC_H, 31);
    // dy ramps from -6 on the left edge to +6 on the right edge.
    const right = new Float32Array(SRC_W * SRC_H);
    for (let u = 0; u < SRC_W; u++) {
      const dy = Math.round(-6 + (12 * u) / SRC_W);
      for (let v = 0; v < SRC_H; v++) {
        const y = v - dy;
        right[v * SRC_W + u] = y >= 0 && y < SRC_H ? left.data[y * SRC_W + u] : 128;
      }
    }
    const est = estimateAlignment(pyramidFrom(left, right));
    expect(est.rotationSuspected).toBe(true);
  });

  it('keeps the swapped flag it was given', () => {
    const left = makeTexture(SRC_W, SRC_H, 41);
    expect(estimateAlignment(pyramidFrom(left, shifted(left, 0, 2)), true).alignment.swapped).toBe(true);
  });
});
