export type SmartViewerMode = 'stereo' | '2d';

export function getSmartViewerMode(): SmartViewerMode {
  if (typeof window === 'undefined') return 'stereo';

  const isPortrait = window.innerHeight > window.innerWidth;

  return isPortrait ? '2d' : 'stereo';
}
