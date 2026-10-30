import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type React from 'react';
import { useStereoGestures } from './useStereoGestures';

type Pt = { x: number; y: number };
const control = document.createElement('button');
control.setAttribute('data-viewer-control', '');
const photo = document.createElement('div');

const ev = (touches: Pt[], changed: Pt[] = touches, target: Element = photo) =>
  ({
    target,
    touches: touches.map((p) => ({ clientX: p.x, clientY: p.y })),
    changedTouches: changed.map((p) => ({ clientX: p.x, clientY: p.y })),
  }) as unknown as React.TouchEvent;

function setup() {
  const onTap = vi.fn();
  const onLeft = vi.fn();
  const onRight = vi.fn();
  const hook = renderHook(() => useStereoGestures(onLeft, onRight, 1400, 800, false, { onTap }));
  const g = () => hook.result.current;
  const tap = (p: Pt = { x: 300, y: 300 }, target: Element = photo) => {
    act(() => g().handleTouchStart(ev([p], [p], target)));
    act(() => vi.advanceTimersByTime(60));
    act(() => g().handleTouchEnd(ev([], [p], target)));
  };
  return { g, tap, onTap, onLeft, onRight };
}

describe('useStereoGestures taps', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a single tap on the photo reports one tap, after the double-tap window', () => {
    const { tap, onTap } = setup();
    tap();
    expect(onTap).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(350));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('a double tap zooms and reports no tap', () => {
    const { tap, onTap, g } = setup();
    tap();
    act(() => vi.advanceTimersByTime(100));
    tap();
    act(() => vi.advanceTimersByTime(400));
    expect(onTap).not.toHaveBeenCalled();
    expect(g().scale).toBeGreaterThan(1);
  });

  it('a tap that starts on a control is the control’s, not a tap on the photo', () => {
    const { tap, onTap } = setup();
    tap({ x: 30, y: 400 }, control);
    act(() => vi.advanceTimersByTime(400));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('a quick two-finger touch is not a tap', () => {
    const { g, onTap } = setup();
    const a = { x: 300, y: 300 }, b = { x: 500, y: 320 };
    act(() => g().handleTouchStart(ev([a])));
    act(() => g().handleTouchStart(ev([a, b])));
    act(() => vi.advanceTimersByTime(80));
    act(() => g().handleTouchEnd(ev([a], [b])));
    act(() => g().handleTouchEnd(ev([], [a])));
    act(() => vi.advanceTimersByTime(400));
    expect(onTap).not.toHaveBeenCalled();
  });

  it('a swipe navigates and is not a tap', () => {
    const { g, onTap, onLeft } = setup();
    const start = { x: 900, y: 400 }, end = { x: 600, y: 410 };
    act(() => g().handleTouchStart(ev([start])));
    act(() => g().handleTouchMove(ev([end])));
    act(() => vi.advanceTimersByTime(150));
    act(() => g().handleTouchEnd(ev([], [end])));
    act(() => vi.advanceTimersByTime(400));
    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(onTap).not.toHaveBeenCalled();
  });

  it('a pan while zoomed is not a tap, and a later tap still is', () => {
    const { g, tap, onTap } = setup();
    tap(); act(() => vi.advanceTimersByTime(100)); tap(); // zoom in
    act(() => vi.advanceTimersByTime(400));
    const s = { x: 400, y: 400 }, e = { x: 470, y: 450 };
    act(() => g().handleTouchStart(ev([s])));
    act(() => g().handleTouchMove(ev([e])));
    act(() => vi.advanceTimersByTime(200));
    act(() => g().handleTouchEnd(ev([], [e])));
    act(() => vi.advanceTimersByTime(400));
    expect(onTap).not.toHaveBeenCalled();
    tap();
    act(() => vi.advanceTimersByTime(400));
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});
