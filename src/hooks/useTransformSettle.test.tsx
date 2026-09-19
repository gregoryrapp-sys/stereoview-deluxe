import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTransformSettle } from '@/hooks/useTransformSettle';

describe('useTransformSettle', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('settles once the transform stops changing', () => {
    const hook = renderHook(({ key }) => useTransformSettle(key), {
      initialProps: { key: '1:0:0' },
    });

    act(() => { vi.advanceTimersByTime(250); });
    expect(hook.result.current).toBe(false);

    // A new transform value re-promotes the stage for the gesture.
    hook.rerender({ key: '2:0:0' });
    expect(hook.result.current).toBe(true);

    act(() => { vi.advanceTimersByTime(250); });
    expect(hook.result.current).toBe(false);
  });

  it('stays promoted while the transform keeps changing', () => {
    const hook = renderHook(({ key }) => useTransformSettle(key), {
      initialProps: { key: '1:0:0' },
    });

    // Successive pinch frames, each closer together than the settle delay.
    for (const scale of ['1.4:0:0', '1.8:0:0', '2.2:0:0']) {
      hook.rerender({ key: scale });
      act(() => { vi.advanceTimersByTime(100); });
      expect(hook.result.current).toBe(true);
    }

    act(() => { vi.advanceTimersByTime(250); });
    expect(hook.result.current).toBe(false);
  });
});
