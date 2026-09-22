import type { StereoAlignment } from './types';

/**
 * Stereo alignment estimator. Pure TypeScript over Float32Arrays: no DOM, no
 * canvas, so it runs identically in a Web Worker and under Vitest.
 *
 * WHAT IT MEASURES
 *
 * Vertical offset (dy) is the one translational component with ground truth:
 * a twin-lens rig that is slightly off produces the same vertical shift across
 * the whole frame, and that shift is what makes a pair uncomfortable at 500%.
 * It is estimated as the weighted median of per-block vertical disparities.
 *
 * Horizontal shift (dx) is NOT a camera error to recover. Horizontal disparity
 * legitimately varies with depth; a global dx is the stereo-window placement,
 * a policy. The estimator returns the disparity distribution (p05/median/p95)
 * so a policy can be applied on top, and leaves dx at 0.
 *
 * Swap detection cannot use the sign of disparity alone: a raw correct pair
 * and a window-adjusted swapped pair look identical by sign. It uses depth
 * ordering instead - content lower in the frame is usually nearer - and only
 * ever SUGGESTS.
 *
 * PIPELINE (per the convention in types.ts, L(x,y) ≈ R(x+dx, y+dy)):
 *  1. high-pass both eyes (removes exposure/vignetting differences)
 *  2. global ZNCC search on an 80 px version for a coarse (dx, dy)
 *  3. refine at 160 px
 *  4. block matching at ~320 px around the coarse estimate -> disparity map
 *  5. refine dy per block at the fine level (~1024 px) with sub-pixel fit
 *  6. robust statistics, rotation guard, swap cue, confidence
 */

export const ALIGN_VERSION = 1;

export interface GrayImage {
  width: number;
  height: number;
  data: Float32Array;
}

export interface SampleLevel {
  width: number;
  height: number;
  left: Float32Array;
  right: Float32Array;
}

export interface SamplePyramid {
  /** Coarse level, ~320 px wide. */
  coarse: SampleLevel;
  /** Fine level, ~1024 px wide (may equal coarse for tiny sources). */
  fine: SampleLevel;
  /** Dimensions of ONE eye in the source, to scale results back. */
  sourceHalfWidth: number;
  sourceHeight: number;
}

export interface AlignmentEstimate {
  /** dy from the estimator, dx 0 (window policy is applied elsewhere), swapped as sampled. */
  alignment: StereoAlignment;
  /** 0..1. Below ~0.3 nothing should be stored. */
  confidence: number;
  swapSuggested: boolean;
  swapConfidence: number;
  rotationSuspected: boolean;
  /** Horizontal disparity distribution in source px (positive = right eye content further right). */
  disparity: { p05: number; median: number; p95: number };
  /** Blocks that passed the texture and correlation gates. */
  inliers: number;
  version: number;
}

// --- tunables ---------------------------------------------------------------
const GLOBAL_SEARCH_DX = 16; // at 80 px  (~ ±20% of width)
const GLOBAL_SEARCH_DY = 8;
const BLOCK_SIZE_COARSE = 32;
/** Wide enough that depth-varying disparity (needed for the swap cue) survives. */
const BLOCK_SEARCH_COARSE = 6;
const BLOCK_SIZE_FINE = 48;
const BLOCK_SEARCH_FINE = 4;
const TEXTURE_MIN_STDDEV = 1.0; // in band-passed intensity units (0..255 scale)
/** Coarse blocks are gated loosely; the fine level applies the real gate. */
const COARSE_MIN_ZNCC = 0.3;
const INLIER_MIN_ZNCC = 0.5;
const ROTATION_SUSPECT_PX = 3; // dy drift across the frame width, in source px
const SWAP_MIN_GRADIENT_PX = 6; // dx change top->bottom needed to speak, in source px
const SWAP_MIN_AGREEMENT = 0.6;

// --- image helpers -----------------------------------------------------------

function boxBlurSeparable(img: GrayImage, radius: number): Float32Array {
  const { width, height, data } = img;
  const tmp = new Float32Array(width * height);
  const out = new Float32Array(width * height);
  const window = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let acc = 0;
    for (let x = -radius; x <= radius; x++) acc += data[row + Math.min(width - 1, Math.max(0, x))];
    for (let x = 0; x < width; x++) {
      tmp[row + x] = acc / window;
      const outIdx = Math.max(0, x - radius);
      const inIdx = Math.min(width - 1, x + radius + 1);
      acc += data[row + inIdx] - data[row + outIdx];
    }
  }
  for (let x = 0; x < width; x++) {
    let acc = 0;
    for (let y = -radius; y <= radius; y++) acc += tmp[Math.min(height - 1, Math.max(0, y)) * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = acc / window;
      const outIdx = Math.max(0, y - radius);
      const inIdx = Math.min(height - 1, y + radius + 1);
      acc += tmp[inIdx * width + x] - tmp[outIdx * width + x];
    }
  }
  return out;
}

/** High-pass: subtract a local mean. Kills lens-to-lens exposure and vignetting. */
export function highPass(img: GrayImage, radius = 4): GrayImage {
  const blurred = boxBlurSeparable(img, radius);
  const data = new Float32Array(img.data.length);
  for (let i = 0; i < data.length; i++) data[i] = img.data[i] - blurred[i];
  return { width: img.width, height: img.height, data };
}

/**
 * Band-pass: high-pass, then a small blur. The blur is what keeps two images
 * correlated when their true offset is a fraction of a pixel at this level -
 * pure high-frequency detail decorrelates at half a pixel and every candidate
 * offset scores alike.
 */
export function bandPass(img: GrayImage): GrayImage {
  const hp = highPass(img, 4);
  return { width: img.width, height: img.height, data: boxBlurSeparable(hp, 1) };
}

/** 2x box downsample. */
export function downsample2(img: GrayImage): GrayImage {
  const width = Math.max(1, Math.floor(img.width / 2));
  const height = Math.max(1, Math.floor(img.height / 2));
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = x * 2;
      const sy = y * 2;
      const i = sy * img.width + sx;
      data[y * width + x] = (img.data[i] + img.data[i + 1] + img.data[i + img.width] + img.data[i + img.width + 1]) * 0.25;
    }
  }
  return { width, height, data };
}

/**
 * Zero-mean normalized cross-correlation between a block of `a` at (ax, ay)
 * and a block of `b` at (bx, by), both `w` x `h`. Returns -1 when the block
 * leaves the image or has no texture. Also returns a's standard deviation so
 * the caller can apply a texture gate once.
 */
function zncc(
  a: GrayImage, ax: number, ay: number,
  b: GrayImage, bx: number, by: number,
  w: number, h: number,
): { score: number; stdA: number } {
  if (ax < 0 || ay < 0 || bx < 0 || by < 0 || ax + w > a.width || ay + h > a.height || bx + w > b.width || by + h > b.height) {
    return { score: -1, stdA: 0 };
  }
  const n = w * h;
  let sumA = 0, sumB = 0;
  for (let y = 0; y < h; y++) {
    const ra = (ay + y) * a.width + ax;
    const rb = (by + y) * b.width + bx;
    for (let x = 0; x < w; x++) {
      sumA += a.data[ra + x];
      sumB += b.data[rb + x];
    }
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let cov = 0, varA = 0, varB = 0;
  for (let y = 0; y < h; y++) {
    const ra = (ay + y) * a.width + ax;
    const rb = (by + y) * b.width + bx;
    for (let x = 0; x < w; x++) {
      const da = a.data[ra + x] - meanA;
      const db = b.data[rb + x] - meanB;
      cov += da * db;
      varA += da * da;
      varB += db * db;
    }
  }
  const stdA = Math.sqrt(varA / n);
  if (varA <= 1e-9 || varB <= 1e-9) return { score: -1, stdA };
  return { score: cov / Math.sqrt(varA * varB), stdA };
}

/** Best (dx, dy) for a block by exhaustive ZNCC in a window around (cx, cy). */
function searchBlock(
  left: GrayImage, x: number, y: number,
  right: GrayImage, w: number, h: number,
  cx: number, cy: number, radiusX: number, radiusY: number,
): { dx: number; dy: number; score: number; stdA: number; scores?: Float32Array } {
  let best = { dx: cx, dy: cy, score: -2, stdA: 0 };
  const side = 2 * radiusX + 1;
  const scores = new Float32Array(side * (2 * radiusY + 1)).fill(-1);
  for (let dy = cy - radiusY; dy <= cy + radiusY; dy++) {
    for (let dx = cx - radiusX; dx <= cx + radiusX; dx++) {
      const { score, stdA } = zncc(left, x, y, right, x + dx, y + dy, w, h);
      scores[(dy - (cy - radiusY)) * side + (dx - (cx - radiusX))] = score;
      if (score > best.score) best = { dx, dy, score, stdA };
    }
  }
  return { ...best, scores };
}

/** Parabolic sub-pixel refinement from three samples around a peak. */
function parabolicOffset(before: number, peak: number, after: number): number {
  const denom = before - 2 * peak + after;
  if (denom >= 0 || !Number.isFinite(denom)) return 0;
  const offset = 0.5 * (before - after) / denom;
  return Math.max(-0.5, Math.min(0.5, offset));
}

function weightedMedian(values: number[], weights: number[]): number {
  if (values.length === 0) return 0;
  const order = values.map((v, i) => i).sort((i, j) => values[i] - values[j]);
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = 0;
  for (const i of order) {
    acc += weights[i];
    if (acc >= total / 2) return values[i];
  }
  return values[order[order.length - 1]];
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function medianAbsoluteDeviation(values: number[], center: number): number {
  if (values.length === 0) return 0;
  const devs = values.map((v) => Math.abs(v - center)).sort((a, b) => a - b);
  return devs[Math.floor(devs.length / 2)];
}

/** Least-squares slope of y on x. */
function slope(xs: number[], ys: number[], weights: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  let sw = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sw += weights[i]; sx += weights[i] * xs[i]; sy += weights[i] * ys[i]; }
  if (sw <= 0) return 0;
  const mx = sx / sw, my = sy / sw;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += weights[i] * (xs[i] - mx) * (ys[i] - my);
    den += weights[i] * (xs[i] - mx) * (xs[i] - mx);
  }
  return den > 1e-9 ? num / den : 0;
}

// --- the estimator ------------------------------------------------------------

interface BlockMatch {
  /** Block centre in the level's pixel space. */
  x: number;
  y: number;
  dx: number;
  dy: number;
  score: number;
}

function toGray(width: number, height: number, data: Float32Array): GrayImage {
  return { width, height, data };
}

export function estimateAlignment(pyramid: SamplePyramid, swapped = false): AlignmentEstimate {
  const empty = (reason?: string): AlignmentEstimate => ({
    alignment: { dx: 0, dy: 0, swapped },
    confidence: 0,
    swapSuggested: false,
    swapConfidence: 0,
    rotationSuspected: false,
    disparity: { p05: 0, median: 0, p95: 0 },
    inliers: 0,
    version: ALIGN_VERSION,
    ...(reason ? {} : {}),
  });

  const coarseL = bandPass(toGray(pyramid.coarse.width, pyramid.coarse.height, pyramid.coarse.left));
  const coarseR = bandPass(toGray(pyramid.coarse.width, pyramid.coarse.height, pyramid.coarse.right));
  if (coarseL.width < 64 || coarseL.height < 48) return empty('too small');

  // Levels: coarse (≈320), half (≈160), quarter (≈80). Re-filtered after each
  // downsample so every level is band-limited for its own pixel grid.
  const halfL = bandPass(downsample2(coarseL)), halfR = bandPass(downsample2(coarseR));
  const quarterL = bandPass(downsample2(halfL)), quarterR = bandPass(downsample2(halfR));

  // 1. Global search at quarter resolution on the central region. A weak peak
  //    is not fatal - block matching below searches a wide window around it -
  //    but nothing correlating at all is a strong hint, so it lowers confidence.
  const marginX = Math.floor(quarterL.width * 0.15) + GLOBAL_SEARCH_DX;
  const marginY = Math.floor(quarterL.height * 0.15) + GLOBAL_SEARCH_DY;
  const regionW = quarterL.width - 2 * marginX;
  const regionH = quarterL.height - 2 * marginY;
  if (regionW < 8 || regionH < 8) return empty('too small');
  let global = searchBlock(quarterL, marginX, marginY, quarterR, regionW, regionH, 0, 0, GLOBAL_SEARCH_DX, GLOBAL_SEARCH_DY);
  const weakGlobal = global.score < 0.2;
  if (weakGlobal) global = { ...global, dx: 0, dy: 0 };

  // 2. Refine at half resolution.
  const halfMarginX = Math.floor(halfL.width * 0.15) + 2 * GLOBAL_SEARCH_DX;
  const halfMarginY = Math.floor(halfL.height * 0.15) + 2 * GLOBAL_SEARCH_DY;
  const half = searchBlock(
    halfL, halfMarginX, halfMarginY, halfR,
    halfL.width - 2 * halfMarginX, halfL.height - 2 * halfMarginY,
    global.dx * 2, global.dy * 2, 3, 3,
  );

  // 3. Block matching at the coarse level around the propagated estimate.
  const coarseDx = half.dx * 2, coarseDy = half.dy * 2;
  const matches: BlockMatch[] = [];
  const B = BLOCK_SIZE_COARSE;
  for (let y = 0; y + B <= coarseL.height; y += B) {
    for (let x = 0; x + B <= coarseL.width; x += B) {
      const m = searchBlock(coarseL, x, y, coarseR, B, B, coarseDx, coarseDy, BLOCK_SEARCH_COARSE, BLOCK_SEARCH_COARSE);
      if (m.stdA < TEXTURE_MIN_STDDEV || m.score < COARSE_MIN_ZNCC) continue;
      matches.push({ x: x + B / 2, y: y + B / 2, dx: m.dx, dy: m.dy, score: m.score });
    }
  }
  if (matches.length < 4) return empty('too few textured blocks');

  // 4. Refine dy (and dx) per block at the fine level with sub-pixel fit.
  const fineL = bandPass(toGray(pyramid.fine.width, pyramid.fine.height, pyramid.fine.left));
  const fineR = bandPass(toGray(pyramid.fine.width, pyramid.fine.height, pyramid.fine.right));
  const ratio = fineL.width / coarseL.width;
  const FB = BLOCK_SIZE_FINE;
  const refined: BlockMatch[] = [];
  for (const m of matches) {
    const fx = Math.round(m.x * ratio - FB / 2);
    const fy = Math.round(m.y * ratio - FB / 2);
    const r = searchBlock(fineL, fx, fy, fineR, FB, FB, Math.round(m.dx * ratio), Math.round(m.dy * ratio), BLOCK_SEARCH_FINE, BLOCK_SEARCH_FINE);
    if (r.score < INLIER_MIN_ZNCC || !r.scores) continue;
    // Sub-pixel: parabola through the neighbours of the peak along each axis.
    const side = 2 * BLOCK_SEARCH_FINE + 1;
    const ix = r.dx - (Math.round(m.dx * ratio) - BLOCK_SEARCH_FINE);
    const iy = r.dy - (Math.round(m.dy * ratio) - BLOCK_SEARCH_FINE);
    const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < side && j < side ? r.scores![j * side + i] : -1);
    const subX = parabolicOffset(at(ix - 1, iy), at(ix, iy), at(ix + 1, iy));
    const subY = parabolicOffset(at(ix, iy - 1), at(ix, iy), at(ix, iy + 1));
    refined.push({ x: fx + FB / 2, y: fy + FB / 2, dx: r.dx + subX, dy: r.dy + subY, score: r.score });
  }
  if (refined.length < 4) return empty('too few fine matches');

  // 5. Statistics in SOURCE pixels.
  const toSource = pyramid.sourceHalfWidth / fineL.width;
  const weights = refined.map((m) => m.score);
  const dys = refined.map((m) => m.dy * toSource);
  const dxs = refined.map((m) => m.dx * toSource);
  const dy = weightedMedian(dys, weights);
  const mad = medianAbsoluteDeviation(dys, dy);

  // Rotation guard: dy that drifts across the frame is rotation, which a
  // translation cannot fix. Report it and still apply the median.
  const xsSource = refined.map((m) => m.x * toSource);
  const dySlope = slope(xsSource, dys, weights);
  const rotationSuspected = Math.abs(dySlope) * pyramid.sourceHalfWidth > ROTATION_SUSPECT_PX;

  // Disparity distribution for the window policy and the swap cue.
  const sortedDx = [...dxs].sort((a, b) => a - b);
  const disparity = {
    p05: percentile(sortedDx, 0.05),
    median: percentile(sortedDx, 0.5),
    p95: percentile(sortedDx, 0.95),
  };

  // Swap cue via depth ordering. With L(x)≈R(x+dx), nearer content has MORE
  // NEGATIVE dx (it sits further right in the left eye). Content lower in the
  // frame is usually nearer, so in a correctly ordered pair dx DEcreases with
  // row index. A positive gradient with real magnitude suggests the halves are
  // exchanged. Flat scenes have no gradient and stay silent.
  const ysSource = refined.map((m) => m.y * toSource);
  const dxSlope = slope(ysSource, dxs, weights);
  const gradientPx = dxSlope * pyramid.sourceHeight;
  // Compare the upper and lower halves of the blocks that SURVIVED, so a band
  // that fell outside the search window does not silence the cue.
  const byRow = [...refined].sort((a, b) => a.y - b.y);
  const upper = byRow.slice(0, Math.floor(byRow.length / 2));
  const lower = byRow.slice(Math.ceil(byRow.length / 2));
  let agreement = 0;
  if (upper.length >= 2 && lower.length >= 2) {
    const upperMedian = percentile([...upper.map((m) => m.dx)].sort((a, b) => a - b), 0.5);
    agreement = lower.filter((m) => m.dx > upperMedian + 0.5).length / lower.length;
  }
  const swapSuggested = gradientPx > SWAP_MIN_GRADIENT_PX && agreement >= SWAP_MIN_AGREEMENT;
  const swapConfidence = swapSuggested
    ? Math.min(1, 0.5 * agreement + 0.5 * Math.min(1, gradientPx / (SWAP_MIN_GRADIENT_PX * 4)))
    : 0;

  // Confidence: how many blocks agreed, how tightly, how well they correlated.
  const inlierFraction = refined.length / Math.max(1, matches.length);
  const meanScore = weights.reduce((s, w) => s + w, 0) / weights.length;
  let confidence = 0.5 * inlierFraction + 0.3 * Math.max(0, 1 - mad / 2) + 0.2 * meanScore;
  if (rotationSuspected) confidence *= 0.5;
  if (weakGlobal) confidence *= 0.7;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    alignment: { dx: 0, dy: Math.round(dy), swapped },
    confidence,
    swapSuggested,
    swapConfidence,
    rotationSuspected,
    disparity,
    inliers: refined.length,
    version: ALIGN_VERSION,
  };
}
