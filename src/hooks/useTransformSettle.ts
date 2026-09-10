import { useEffect, useState } from 'react';

// How long the transform must hold still before rasterization is handed back to
// the browser. Long enough that the gap between two pinch frames does not tear
// the layer down mid-gesture, short enough that detail snaps in as soon as the
// fingers lift.
const SETTLE_DELAY_MS = 200;

/**
 * Reports whether a transform is still actively changing.
 *
 * A GPU-promoted layer is rasterized once at its current scale and then
 * stretched by the compositor, so a stage carrying `will-change: transform`
 * permanently displays a magnified 1x texture at every zoom level. Viewers use
 * this flag to promote the stage only while a gesture is in flight, then drop
 * both the hint and the 3D transform so the browser re-rasterizes the image at
 * the zoomed resolution.
 *
 * @param transformKey Any value that changes whenever the transform changes.
 */
export function useTransformSettle(transformKey: string | number): boolean {
  const [isTransforming, setIsTransforming] = useState(false);

  useEffect(() => {
    setIsTransforming(true);
    const timer = window.setTimeout(() => setIsTransforming(false), SETTLE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [transformKey]);

  return isTransforming;
}
