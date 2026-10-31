import { ROTATION_NOISE_FLOOR_DEG, type StereoAlignment } from './types';

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
 * a policy. The policy applied here mirrors the photographer's own pipeline
 * (SingleCheckFlip-AutoAlign.py): a RANSAC similarity fit over ALL matches
 * registers the dominant plane, which in block terms is the weighted median
 * disparity. `windowPolicy: 'consensus'` (default) sets dx to that; 'none'
 * leaves dx at 0 and only reports the distribution.
 *
 * Swap detection cannot use the sign of disparity alone: a raw correct pair
 * and a window-adjusted swapped pair look identical by sign. It mirrors the
 * script's `detect_stereo_order`: register the BACKGROUND band (rows 20-55%),
 * then look at the FOREGROUND (rows >= 55%). After background registration,
 * foreground content sits further right in the left eye - i.e. its residual
 * disparity (x_R - x_L) is negative. A positive median residual with >= 80%
 * direction agreement and >= 1.5 px magnitude suggests the halves are
 * exchanged. Below those thresholds it stays silent rather than guess, exactly
 * as the script raises rather than swaps. Here it only ever SUGGESTS.
 *
 * PIPELINE (per the convention in types.ts, L(x,y) ≈ R(x+dx, y+dy)):
 *  1. high-pass both eyes (removes exposure/vignetting differences)
 *  2. global ZNCC search on an 80 px version for a coarse (dx, dy)
 *  3. refine at 160 px
 *  4. block matching at ~320 px around the coarse estimate -> disparity map
 *  5. refine dy per block at the fine level (~1024 px) with sub-pixel fit
 *  6. robust statistics, rotation guard, swap cue, confidence
 */

/** 2: rotation and scale are fitted (v1 refused anything but a pure shift). */
export const ALIGN_VERSION = 2;

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
  /** The dx the consensus policy would apply (weighted median disparity), whatever policy was used. */
  windowDx: number;
  /** Blocks that passed the texture and correlation gates. */
  inliers: number;
  version: number;
  /** How the confidence was built; for the owner's Measured line and for tuning. */
  diagnostics?: {
    inlierFraction: number;
    /** MAD of the vertical residual after the fit, source px. */
    verticalSpread: number;
    meanScore: number;
    residualDrift: boolean;
    fitInliers: number;
  };
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
/** Similarity fit: RANSAC on the fine matches. Residual threshold in fine-level px. */
const FIT_RANSAC_ITERATIONS = 300;
const FIT_INLIER_PX = 1.5;
/** Beyond this the fit is not a camera misalignment; fall back to a pure shift. */
const MAX_ROTATION_DEG = 3;
/**
 * Smaller than this is noise; store a pure shift so nothing is resampled for
 * nothing. Calibrated on real pairs: factory-calibrated iPhone spatial photos
 * measure 0-0.054° (seven photos), the photographer's two-camera rig 0.35-0.56°.
 * 0.1° is about 2-3 px at the edge of a 2700-3600 px eye.
 */
const MIN_ROTATION_DEG = ROTATION_NOISE_FLOOR_DEG;
// Stereo-order check, calibrated to SingleCheckFlip-AutoAlign.py: background
// band 20-55% of height, foreground >= 55%, >= 1.5 px parallax at its
// 2200 px detection size, >= 80% of foreground agreeing on direction.
const SWAP_BACKGROUND_TOP = 0.2;
const SWAP_BACKGROUND_BOTTOM = 0.55;
const SWAP_MIN_BACKGROUND_BLOCKS = 6;
const SWAP_MIN_FOREGROUND_BLOCKS = 4;
const SWAP_MIN_PARALLAX_PX_AT_2200 = 1.5;
const SWAP_MIN_AGREEMENT = 0.8;

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

interface Similarity {
  /** radians, counter-clockwise positive */
  theta: number;
  scale: number;
  tx: number;
  ty: number;
}

type Point = { x: number; y: number };

/**
 * Weighted least-squares 2D similarity q ≈ s·R(θ)·p + t (Umeyama / Procrustes).
 * Points are relative to the eye centre so the rotation is about it.
 */
function fitSimilarity(p: Point[], q: Point[], w: number[]): Similarity | null {
  const n = p.length;
  if (n < 2) return null;
  let sw = 0, mpx = 0, mpy = 0, mqx = 0, mqy = 0;
  for (let i = 0; i < n; i++) {
    sw += w[i];
    mpx += w[i] * p[i].x;
    mpy += w[i] * p[i].y;
    mqx += w[i] * q[i].x;
    mqy += w[i] * q[i].y;
  }
  if (sw <= 0) return null;
  mpx /= sw; mpy /= sw; mqx /= sw; mqy /= sw;
  let a = 0, b = 0, varP = 0;
  for (let i = 0; i < n; i++) {
    const px = p[i].x - mpx, py = p[i].y - mpy, qx = q[i].x - mqx, qy = q[i].y - mqy;
    a += w[i] * (px * qx + py * qy);
    b += w[i] * (px * qy - py * qx);
    varP += w[i] * (px * px + py * py);
  }
  if (varP <= 1e-9) return null;
  const theta = Math.atan2(b, a);
  const scale = Math.sqrt(a * a + b * b) / varP;
  const cos = Math.cos(theta), sin = Math.sin(theta);
  return { theta, scale, tx: mqx - scale * (cos * mpx - sin * mpy), ty: mqy - scale * (sin * mpx + cos * mpy) };
}

function similarityResidual(fit: Similarity, p: Point, q: Point): Point {
  const cos = Math.cos(fit.theta), sin = Math.sin(fit.theta);
  return {
    x: q.x - (fit.scale * (cos * p.x - sin * p.y) + fit.tx),
    y: q.y - (fit.scale * (sin * p.x + cos * p.y) + fit.ty),
  };
}

/**
 * Rotation from the VERTICAL disparity field only.
 *
 * Horizontal disparity legitimately varies with depth, so a fit on (dx, dy)
 * reads foreground parallax as rotation. Vertical disparity does not depend
 * on depth for side-by-side cameras, so it is a clean read of the rig: for a
 * small rotation θ about the eye centre, dy ≈ ty + θ·x. Fitted robustly
 * (deterministic RANSAC, 2-point samples, weighted least squares on the
 * inliers).
 *
 * No scale term, by the photographer's decision: matched lenses do not differ
 * in size, a fitted "scale" mostly absorbs a slightly toed-in camera, and
 * the right eye is not to be resampled for it. Rotation alone was what the
 * rig needed.
 */
function fitVerticalField(
  pts: Point[],
  dys: number[],
  w: number[],
  thresholdPx: number,
): { theta: number; scale: number; ty: number; inliers: number[] } | null {
  const n = pts.length;
  if (n < 6) return null;
  const solve = (idx: number[], weights: number[]): [number, number, number] | null => {
    // Weighted normal equations for dy = a + b·x.
    let s00 = 0, s01 = 0, s11 = 0, r0 = 0, r1 = 0;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k], wk = weights[k], x = pts[i].x, d = dys[i];
      s00 += wk; s01 += wk * x; s11 += wk * x * x;
      r0 += wk * d; r1 += wk * x * d;
    }
    const det = s00 * s11 - s01 * s01;
    if (Math.abs(det) < 1e-9) return null;
    const a = (r0 * s11 - s01 * r1) / det;
    const b = (s00 * r1 - s01 * r0) / det;
    return [a, b, 0];
  };
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let best: { coef: [number, number, number]; inliers: number[] } | null = null;
  for (let iter = 0; iter < FIT_RANSAC_ITERATIONS; iter++) {
    const sample = new Set<number>();
    while (sample.size < 2) sample.add(Math.floor(rand() * n));
    const coef = solve([...sample], [1, 1]);
    if (!coef) continue;
    const inliers: number[] = [];
    for (let i = 0; i < n; i++) {
      if (Math.abs(dys[i] - (coef[0] + coef[1] * pts[i].x)) <= thresholdPx) inliers.push(i);
    }
    if (!best || inliers.length > best.inliers.length) best = { coef, inliers };
  }
  if (!best || best.inliers.length < 6) return null;
  const coef = solve(best.inliers, best.inliers.map((i) => w[i])) ?? best.coef;
  return { theta: Math.atan(coef[1]), scale: 1, ty: coef[0], inliers: best.inliers };
}

function toGray(width: number, height: number, data: Float32Array): GrayImage {
  return { width, height, data };
}

export type WindowPolicy = 'consensus' | 'none';

export interface EstimateOptions {
  /** 'consensus' (default) registers the dominant plane like the RANSAC fit in the customer's script. */
  windowPolicy?: WindowPolicy;
}

export function estimateAlignment(
  pyramid: SamplePyramid,
  swapped = false,
  options: EstimateOptions = {},
): AlignmentEstimate {
  const windowPolicy = options.windowPolicy ?? 'consensus';
  const empty = (reason?: string): AlignmentEstimate => ({
    alignment: { dx: 0, dy: 0, swapped },
    confidence: 0,
    swapSuggested: false,
    swapConfidence: 0,
    rotationSuspected: false,
    disparity: { p05: 0, median: 0, p95: 0 },
    windowDx: 0,
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

  // 5a. Similarity fit (rotation, scale, shift) on the fine matches, the way
  //     the photographer's script fits one with SIFT + RANSAC. Points are
  //     relative to the eye centre so the rotation is about it. Cameras that
  //     are not perfectly level show up as dy drifting across the frame; v1
  //     could only detect that and refuse. Now it is modelled, and the
  //     residuals after the fit feed the shift, the swap cue and the confidence.
  const cx = fineL.width / 2, cy = fineL.height / 2;
  const pts = refined.map((m) => ({ x: m.x - cx, y: m.y - cy }));
  const qts = refined.map((m) => ({ x: m.x + m.dx - cx, y: m.y + m.dy - cy }));
  const vertical = fitVerticalField(pts, refined.map((m) => m.dy), weights, FIT_INLIER_PX);
  let rotationDeg = 0;
  const scale = 1;
  let fitUsed = false;
  if (vertical) {
    const deg = (vertical.theta * 180) / Math.PI;
    if (Math.abs(deg) <= MAX_ROTATION_DEG) {
      fitUsed = true;
      rotationDeg = Math.abs(deg) >= MIN_ROTATION_DEG ? deg : 0;
    }
  }
  // Per-match shift with the rotation and scale taken out: what each block's
  // disparity would be if the cameras were level. Everything below reads these.
  const fit: Similarity = { theta: (rotationDeg * Math.PI) / 180, scale, tx: 0, ty: 0 };
  const dxs = refined.map((_, i) => similarityResidual(fit, pts[i], qts[i]).x * toSource);
  const dys = refined.map((_, i) => similarityResidual(fit, pts[i], qts[i]).y * toSource);

  // The vertical shift, its spread and any leftover drift are read on the
  // plane the fit registered (its inliers), the way the script's RANSAC
  // converges on the dominant plane. Matches off that plane are foreground
  // with its own vertical parallax (a rig that is not perfectly side by side
  // produces some); a similarity cannot remove it and the script does not
  // either, so it must not count against the measurement.
  const planeIdx = vertical && fitUsed ? vertical.inliers : refined.map((_, i) => i);
  const planeDys = planeIdx.map((i) => dys[i]);
  const planeWeights = planeIdx.map((i) => weights[i]);
  const dy = weightedMedian(planeDys, planeWeights);
  const mad = medianAbsoluteDeviation(planeDys, dy);

  // Drift the fit could not absorb (or a rejected, implausible fit) keeps v1's
  // guard; `rotationSuspected` now reports that a rotation was modelled.
  const dySlope = slope(planeIdx.map((i) => refined[i].x * toSource), planeDys, planeWeights);
  const residualDrift = Math.abs(dySlope) * pyramid.sourceHalfWidth > ROTATION_SUSPECT_PX;
  const rotationSuspected = fitUsed ? rotationDeg !== 0 : residualDrift;
  const planeShare = planeIdx.length / refined.length;

  // Disparity distribution for the window policy and the swap cue.
  const sortedDx = [...dxs].sort((a, b) => a - b);
  const disparity = {
    p05: percentile(sortedDx, 0.05),
    median: percentile(sortedDx, 0.5),
    p95: percentile(sortedDx, 0.95),
  };

  // Window policy: the dominant plane. The script's RANSAC similarity fit over
  // all matches converges on the plane most matches lie on; the weighted median
  // of block disparities is the same idea without RANSAC.
  const windowDx = weightedMedian(dxs, weights);

  // Stereo-order check (see header). Register the background band, then read
  // the foreground residual. In L(x)≈R(x+dx) terms, correctly ordered
  // foreground has residual < 0.
  const rowFraction = (m: BlockMatch) => m.y / fineL.height;
  const background = refined.filter((m) => rowFraction(m) >= SWAP_BACKGROUND_TOP && rowFraction(m) <= SWAP_BACKGROUND_BOTTOM);
  const foreground = refined.filter((m) => rowFraction(m) > SWAP_BACKGROUND_BOTTOM);
  let swapSuggested = false;
  let swapConfidence = 0;
  if (background.length >= SWAP_MIN_BACKGROUND_BLOCKS && foreground.length >= SWAP_MIN_FOREGROUND_BLOCKS) {
    const backgroundDx = weightedMedian(background.map((m) => m.dx * toSource), background.map((m) => m.score));
    const residuals = foreground.map((m) => m.dx * toSource - backgroundDx);
    const medianResidual = weightedMedian(residuals, foreground.map((m) => m.score));
    const minParallax = SWAP_MIN_PARALLAX_PX_AT_2200 * Math.max(1, pyramid.sourceHalfWidth / 2200);
    const agreement = residuals.filter((r) => Math.sign(r) === Math.sign(medianResidual) && r !== 0).length / residuals.length;
    if (Math.abs(medianResidual) >= minParallax && agreement >= SWAP_MIN_AGREEMENT && medianResidual > 0) {
      swapSuggested = true;
      swapConfidence = Math.min(1, 0.5 * agreement + 0.5 * Math.min(1, Math.abs(medianResidual) / (minParallax * 6)));
    }
  }

  // Confidence: how many blocks agreed, how tightly, how well they correlated.
  const inlierFraction = refined.length / Math.max(1, matches.length);
  const meanScore = weights.reduce((s, w) => s + w, 0) / weights.length;
  // Spread is judged relative to the source size: 2 px on a 3600 px eye is
  // the same precision as 1.2 px on a 2200 px one.
  const madNormalised = mad / Math.max(1, pyramid.sourceHalfWidth / 2200);
  let confidence = 0.5 * inlierFraction + 0.3 * Math.max(0, 1 - madNormalised / 2) + 0.2 * meanScore;
  // A plane that only part of the frame sits on is a real but partial
  // correction: still worth storing, trusted a little less. Concert frames
  // with a big foreground put only half the blocks on the stage plane.
  confidence *= 0.7 + 0.3 * planeShare;
  if (residualDrift) confidence *= 0.5;
  if (weakGlobal) confidence *= 0.7;
  confidence = Math.max(0, Math.min(1, confidence));

  const alignment: StereoAlignment = {
    dx: windowPolicy === 'consensus' ? Math.round(windowDx) : 0,
    dy: Math.round(dy),
    swapped,
  };
  if (rotationDeg !== 0) alignment.rotation = Math.round(rotationDeg * 1000) / 1000;

  return {
    alignment,
    confidence,
    swapSuggested,
    swapConfidence,
    rotationSuspected,
    disparity,
    windowDx: Math.round(windowDx),
    inliers: refined.length,
    version: ALIGN_VERSION,
    diagnostics: {
      inlierFraction,
      verticalSpread: mad,
      meanScore,
      residualDrift,
      fitInliers: vertical?.inliers.length ?? 0,
    },
  };
}
