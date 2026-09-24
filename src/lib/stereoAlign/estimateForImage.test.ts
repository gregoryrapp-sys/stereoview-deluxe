import { describe, expect, it } from 'vitest';
import type { AlignmentEstimate } from './estimator';
import { applyEstimate } from './estimateForImage';

function estimate(over: Partial<AlignmentEstimate>): AlignmentEstimate {
  return {
    alignment: { dx: 12, dy: -5, swapped: false },
    confidence: 0.9,
    swapSuggested: false,
    swapConfidence: 0,
    rotationSuspected: false,
    disparity: { p05: 0, median: 12, p95: 20 },
    windowDx: 12,
    inliers: 40,
    version: 1,
    ...over,
  };
}

describe('applyEstimate', () => {
  it('keeps the measured offsets and the displayed order when no swap is suggested', () => {
    expect(applyEstimate(estimate({}), false)).toEqual({ dx: 12, dy: -5, swapped: false });
    expect(applyEstimate(estimate({}), true)).toEqual({ dx: 12, dy: -5, swapped: true });
  });

  it('flips the halves and negates the offsets when the depth cue is clear', () => {
    expect(applyEstimate(estimate({ swapSuggested: true }), false)).toEqual({ dx: -12, dy: 5, swapped: true });
    // Measured in an already-swapped order and found exchanged again: back to unswapped.
    expect(applyEstimate(estimate({ swapSuggested: true }), true)).toEqual({ dx: -12, dy: 5, swapped: false });
  });
});
