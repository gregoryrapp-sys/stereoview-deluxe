import { Capacitor } from '@capacitor/core';

export function isNativeMobileApp() {
  return Capacitor.isNativePlatform();
}
