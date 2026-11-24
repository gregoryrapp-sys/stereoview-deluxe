/**
 * What kind of device is looking, for hints that only make sense on some:
 * - phone: touch, short side under 600 CSS px. Rotating matters, and the
 *   halves are small enough for a phone viewer/headset or free-viewing.
 * - tablet: touch, bigger. Rotating matters; the halves are too far apart
 *   for free-viewing and too big for a phone viewer.
 * - desktop: mouse or trackpad. Neither applies.
 */
export type DeviceKind = 'phone' | 'tablet' | 'desktop';

export function deviceKind(
  win: Pick<Window, 'matchMedia' | 'screen'> | undefined = typeof window === 'undefined' ? undefined : window,
): DeviceKind {
  if (!win) return 'desktop';
  const touch = win.matchMedia?.('(pointer: coarse)').matches ?? false;
  if (!touch) return 'desktop';
  return Math.min(win.screen.width, win.screen.height) < 600 ? 'phone' : 'tablet';
}
