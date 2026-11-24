import { describe, expect, it } from 'vitest';
import { deviceKind } from './device';

const fake = (coarse: boolean, width: number, height: number) => ({
  matchMedia: (q: string) => ({ matches: coarse && q === '(pointer: coarse)' }) as MediaQueryList,
  screen: { width, height } as Screen,
});

describe('deviceKind', () => {
  it('tells phones, tablets and desktops apart', () => {
    expect(deviceKind(fake(true, 390, 844))).toBe('phone');
    expect(deviceKind(fake(true, 844, 390))).toBe('phone'); // held sideways
    expect(deviceKind(fake(true, 820, 1180))).toBe('tablet');
    expect(deviceKind(fake(false, 1440, 900))).toBe('desktop');
    expect(deviceKind(undefined)).toBe('desktop');
  });
});
