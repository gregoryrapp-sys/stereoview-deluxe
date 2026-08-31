import { useState, useCallback, useRef } from 'react';

interface GestureState {
  scale: number;
  translateX: number;
  translateY: number;
}

interface TouchPoint {
  x: number;
  y: number;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;
const DOUBLE_TAP_ZOOM = 2.5;
const DEFAULT_SCALE = 1;
const SCALE_EPSILON = 0.01;
const SWIPE_THRESHOLD = 50;
const SWIPE_VELOCITY_THRESHOLD = 0.3;
// A slow but deliberate drag this far counts as a swipe even without the velocity.
const SWIPE_DISTANCE_OVERRIDE = 100;
const DOUBLE_TAP_WINDOW = 300;
// A touch only counts as a tap if the finger barely moved and lifted quickly.
// Without this a swipe registers as a tap and the second swipe of a sequence
// gets read as a double tap, zooming in and killing all further swipes.
const TAP_MAX_MOVEMENT = 10;
const TAP_MAX_DURATION = 250;

export function useStereoGestures(
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
  containerWidth: number,
  containerHeight: number,
  isPortrait: boolean = false
) {
  const [state, setState] = useState<GestureState>({
    scale: DEFAULT_SCALE,
    translateX: 0,
    translateY: 0,
  });

  const lastTouchRef = useRef<TouchPoint | null>(null);
  const lastTouchTimeRef = useRef<number>(0);
  const initialPinchDistanceRef = useRef<number>(0);
  const initialScaleRef = useRef<number>(DEFAULT_SCALE);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isPinchingRef = useRef(false);

  const clampTranslate = useCallback((x: number, y: number, scale: number) => {
    if (scale <= DEFAULT_SCALE) {
      return { x: 0, y: 0 };
    }

    // Calculate max pan based on zoom level
    // Each half of the image is containerWidth/2 wide
    const halfWidth = containerWidth / 2;
    const maxPanX = (halfWidth * (scale - 1)) / 2;
    const maxPanY = (containerHeight * (scale - 1)) / 2;

    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, y)),
    };
  }, [containerWidth, containerHeight]);

  const getDistance = (touches: React.TouchList): number => {
    const t1 = touches[0];
    const t2 = touches[1];
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  };

  // Transform screen coordinates to view coordinates when in portrait mode
  // When content is rotated 90deg clockwise, we need to transform touch deltas:
  // - Screen right (positive X) → View up (negative Y)
  // - Screen down (positive Y) → View right (positive X)
  const transformDelta = useCallback((deltaX: number, deltaY: number): { x: number; y: number } => {
    if (isPortrait) {
      return {
        x: deltaY,
        y: -deltaX,
      };
    }
    return { x: deltaX, y: deltaY };
  }, [isPortrait]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      // Pinch start
      isPinchingRef.current = true;
      initialPinchDistanceRef.current = getDistance(e.touches);
      initialScaleRef.current = state.scale;
    } else if (e.touches.length === 1) {
      const touch = e.touches[0];
      lastTouchRef.current = { x: touch.clientX, y: touch.clientY };
      touchStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
    }
  }, [state.scale]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // No preventDefault here: React registers touchmove passively on the root,
    // so the call would be ignored. `touch-action: none` on the container
    // (.viewer-container in index.css) is what actually suppresses the
    // browser's own scroll/zoom gestures.
    if (e.touches.length === 2 && isPinchingRef.current) {
      // Pinch zoom
      const currentDistance = getDistance(e.touches);
      const scaleChange = currentDistance / initialPinchDistanceRef.current;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, initialScaleRef.current * scaleChange));

      setState(prev => {
        const clamped = clampTranslate(prev.translateX, prev.translateY, newScale);
        return {
          scale: newScale,
          translateX: clamped.x,
          translateY: clamped.y,
        };
      });
    } else if (e.touches.length === 1 && lastTouchRef.current && !isPinchingRef.current) {
      const touch = e.touches[0];
      const rawDeltaX = touch.clientX - lastTouchRef.current.x;
      const rawDeltaY = touch.clientY - lastTouchRef.current.y;

      // Transform deltas for portrait mode rotation
      const { x: deltaX, y: deltaY } = transformDelta(rawDeltaX, rawDeltaY);

      lastTouchRef.current = { x: touch.clientX, y: touch.clientY };

      // Only pan if zoomed in
      if (state.scale > DEFAULT_SCALE) {
        setState(prev => {
          const clamped = clampTranslate(
            prev.translateX + deltaX,
            prev.translateY + deltaY,
            prev.scale
          );
          return {
            ...prev,
            translateX: clamped.x,
            translateY: clamped.y,
          };
        });
      }
    }
  }, [state.scale, clampTranslate, transformDelta]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 0) {
      isPinchingRef.current = false;

      const now = Date.now();
      let didSwipe = false;
      let wasTap = false;

      if (touchStartRef.current) {
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const rawDeltaX = endX - touchStartRef.current.x;
        const rawDeltaY = endY - touchStartRef.current.y;
        const deltaTime = now - touchStartRef.current.time;

        // Transform deltas for portrait mode rotation
        const { x: deltaX, y: deltaY } = transformDelta(rawDeltaX, rawDeltaY);

        const distance = Math.hypot(rawDeltaX, rawDeltaY);
        wasTap = distance < TAP_MAX_MOVEMENT && deltaTime < TAP_MAX_DURATION;

        // Swipe only when at (or below) the default size. The epsilon matters:
        // a pinch that settles at 1.02 would otherwise disable swiping for good.
        const isZoomedOut = state.scale <= DEFAULT_SCALE + SCALE_EPSILON;
        const velocity = deltaTime > 0 ? Math.abs(deltaX) / deltaTime : 0;
        const isHorizontal = Math.abs(deltaX) > Math.abs(deltaY);
        const farEnough = Math.abs(deltaX) > SWIPE_THRESHOLD;
        // Distance OR velocity, so a slow deliberate drag still navigates.
        const fastOrFarEnough =
          velocity > SWIPE_VELOCITY_THRESHOLD || Math.abs(deltaX) > SWIPE_DISTANCE_OVERRIDE;

        if (isZoomedOut && isHorizontal && farEnough && fastOrFarEnough) {
          didSwipe = true;
          if (deltaX > 0) {
            onSwipeRight();
          } else {
            onSwipeLeft();
          }
        }
      }

      // Double tap: only ever from two genuine taps. A swipe must not seed the
      // window, otherwise the next swipe in a sequence zooms in and every
      // subsequent swipe is silently rejected by the isZoomedOut check above.
      if (wasTap && !didSwipe) {
        if (now - lastTouchTimeRef.current < DOUBLE_TAP_WINDOW) {
          setState(prev => {
            if (Math.abs(prev.scale - DEFAULT_SCALE) > SCALE_EPSILON) {
              // Reset to default
              return { scale: DEFAULT_SCALE, translateX: 0, translateY: 0 };
            } else {
              // Zoom in
              return { scale: DOUBLE_TAP_ZOOM, translateX: 0, translateY: 0 };
            }
          });
          // Consume the pair so a third tap does not immediately re-trigger.
          lastTouchTimeRef.current = 0;
        } else {
          lastTouchTimeRef.current = now;
        }
      } else {
        lastTouchTimeRef.current = 0;
      }

      lastTouchRef.current = null;
      touchStartRef.current = null;
    } else if (e.touches.length === 1) {
      // Transition from pinch to single touch
      isPinchingRef.current = false;
      const touch = e.touches[0];
      lastTouchRef.current = { x: touch.clientX, y: touch.clientY };
    }
  }, [state.scale, onSwipeLeft, onSwipeRight, transformDelta]);

  // The browser can steal a gesture mid-swipe (Android's edge-back gesture,
  // pull-to-refresh, an incoming call). touchend never fires in that case, so
  // without this the refs stay stale and the next gesture misbehaves.
  const handleTouchCancel = useCallback(() => {
    isPinchingRef.current = false;
    lastTouchRef.current = null;
    touchStartRef.current = null;
    lastTouchTimeRef.current = 0;
  }, []);

  const resetTransform = useCallback(() => {
    setState({ scale: DEFAULT_SCALE, translateX: 0, translateY: 0 });
  }, []);

  return {
    scale: state.scale,
    translateX: state.translateX,
    translateY: state.translateY,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    resetTransform,
  };
}
