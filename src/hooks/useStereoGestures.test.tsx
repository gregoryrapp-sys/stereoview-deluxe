import type React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStereoGestures } from '@/hooks/useStereoGestures';

// Minimal React.TouchEvent stand-ins - the hook only reads touches,
// changedTouches and their clientX/clientY.
type TouchEventLike = React.TouchEvent<HTMLDivElement>;

const t = (x: number, y: number) => ({ clientX: x, clientY: y });
const start = (x: number, y: number) => ({ touches: [t(x, y)] }) as unknown as TouchEventLike;
const end = (x: number, y: number) =>
  ({ touches: [], changedTouches: [t(x, y)] }) as unknown as TouchEventLike;

function setup() {
  const onLeft = vi.fn();
  const onRight = vi.fn();
  const hook = renderHook(() => useStereoGestures(onLeft, onRight, 1000, 500, false));
  return { hook, onLeft, onRight };
}

type Hook = ReturnType<typeof setup>['hook'];

// swipe: press at x0, release at x1 after `ms`
function swipe(hook: Hook, x0: number, x1: number, ms: number) {
  act(() => { hook.result.current.handleTouchStart(start(x0, 250)); });
  vi.advanceTimersByTime(ms);
  act(() => { hook.result.current.handleTouchEnd(end(x1, 250)); });
}

function tap(hook: Hook, x = 500) {
  act(() => { hook.result.current.handleTouchStart(start(x, 250)); });
  vi.advanceTimersByTime(50);
  act(() => { hook.result.current.handleTouchEnd(end(x, 250)); });
}

describe('useStereoGestures', () => {
  it('regression: four rapid swipes all navigate, with no accidental zoom', () => {
    vi.useFakeTimers();
    const { hook, onLeft } = setup();
    for (let i = 0; i < 4; i++) {
      swipe(hook, 800, 600, 100);   // fast leftward swipe -> onSwipeLeft
      vi.advanceTimersByTime(120);  // next swipe starts <300ms later
    }
    expect(onLeft).toHaveBeenCalledTimes(4);
    expect(hook.result.current.scale).toBe(1); // never auto-zoomed
    vi.useRealTimers();
  });

  it('regression: slow deliberate 120px drag still navigates', () => {
    vi.useFakeTimers();
    const { hook, onLeft } = setup();
    swipe(hook, 800, 680, 500); // velocity 0.24 px/ms -> below threshold
    expect(onLeft).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('genuine double tap still zooms', () => {
    vi.useFakeTimers();
    const { hook } = setup();
    tap(hook);
    vi.advanceTimersByTime(100);
    tap(hook);
    expect(hook.result.current.scale).toBe(2.5);
    vi.useRealTimers();
  });

  it('vertical drag does not navigate', () => {
    vi.useFakeTimers();
    const { hook, onLeft, onRight } = setup();
    act(() => { hook.result.current.handleTouchStart(start(500, 100)); });
    vi.advanceTimersByTime(200);
    act(() => { hook.result.current.handleTouchEnd(end(560, 400)); });
    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('regression: touch cancel leaves no stale state', () => {
    vi.useFakeTimers();
    const { hook, onLeft, onRight } = setup();
    act(() => { hook.result.current.handleTouchStart(start(800, 250)); });
    act(() => { hook.result.current.handleTouchCancel(); });
    act(() => { hook.result.current.handleTouchEnd(end(600, 250)); });
    expect(onLeft).not.toHaveBeenCalled();
    expect(onRight).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('rightward swipe goes to previous', () => {
    vi.useFakeTimers();
    const { hook, onRight } = setup();
    swipe(hook, 200, 400, 100);
    expect(onRight).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
