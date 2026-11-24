import { useCallback, useState } from 'react';

/**
 * The viewer's own eye-separation (parallax) setting.
 *
 * Side by side, each eye's picture is centred in its half of the screen. For
 * most people that fuses; someone whose eyes are unusually close together or
 * far apart (or whose headset lenses sit differently) struggles. This shifts
 * both pictures toward the centre (positive steps) or away from it
 * (negative), by a fraction of the half-screen so a step means the same on a
 * phone and on a TV.
 *
 * It belongs to the person and the device, not the photo: set once, kept in
 * localStorage until changed, applied to every photo, video and QuickView.
 */

const STORAGE_KEY = 'viewer-eye-separation';
/** Each step moves each eye by this fraction of its half of the screen. */
export const SEPARATION_STEP = 0.01;
export const MAX_SEPARATION_STEPS = 15;

export function clampSteps(steps: number): number {
  if (!Number.isFinite(steps)) return 0;
  return Math.max(-MAX_SEPARATION_STEPS, Math.min(MAX_SEPARATION_STEPS, Math.round(steps)));
}

function readSteps(): number {
  try {
    return clampSteps(Number(localStorage.getItem(STORAGE_KEY) ?? 0));
  } catch {
    return 0;
  }
}

function writeSteps(steps: number) {
  try {
    if (steps === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(steps));
  } catch {
    // Private mode: the setting lasts for this visit only.
  }
}

/** How far (CSS px) each eye moves toward the centre for a given half-screen width. */
export function separationOffsetPx(steps: number, halfWidth: number): number {
  return clampSteps(steps) * SEPARATION_STEP * halfWidth;
}

export function useEyeSeparation() {
  const [steps, setSteps] = useState(readSteps);

  const update = useCallback((next: (current: number) => number) => {
    setSteps((current) => {
      const value = clampSteps(next(current));
      writeSteps(value);
      return value;
    });
  }, []);

  const closer = useCallback(() => update((current) => current + 1), [update]);
  const farther = useCallback(() => update((current) => current - 1), [update]);
  const reset = useCallback(() => update(() => 0), [update]);

  return { steps, closer, farther, reset };
}
