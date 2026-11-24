import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { clampSteps, MAX_SEPARATION_STEPS, separationOffsetPx, useEyeSeparation } from './useEyeSeparation';

// Node's own (disabled) localStorage shadows jsdom's; use an in-memory one.
beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, String(value)),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('useEyeSeparation', () => {
  it('starts at the default and remembers a change for the next viewer', () => {
    const first = renderHook(() => useEyeSeparation());
    expect(first.result.current.steps).toBe(0);
    act(() => first.result.current.closer());
    act(() => first.result.current.closer());
    expect(first.result.current.steps).toBe(2);

    const later = renderHook(() => useEyeSeparation());
    expect(later.result.current.steps).toBe(2);
  });

  it('moves apart, and reset returns to the default and forgets it', () => {
    const { result } = renderHook(() => useEyeSeparation());
    act(() => result.current.farther());
    expect(result.current.steps).toBe(-1);
    act(() => result.current.reset());
    expect(result.current.steps).toBe(0);
    expect(localStorage.getItem('viewer-eye-separation')).toBeNull();
  });

  it('stops at the limits', () => {
    const { result } = renderHook(() => useEyeSeparation());
    for (let i = 0; i < MAX_SEPARATION_STEPS + 5; i++) act(() => result.current.closer());
    expect(result.current.steps).toBe(MAX_SEPARATION_STEPS);
  });

  it('ignores a corrupt stored value', () => {
    localStorage.setItem('viewer-eye-separation', 'banana');
    expect(renderHook(() => useEyeSeparation()).result.current.steps).toBe(0);
  });
});

describe('separationOffsetPx', () => {
  it('is a fraction of the half-screen per step, clamped', () => {
    expect(separationOffsetPx(3, 800)).toBe(24);
    expect(separationOffsetPx(-2, 800)).toBe(-16);
    expect(separationOffsetPx(99, 800)).toBe(clampSteps(99) * 8);
  });
});
