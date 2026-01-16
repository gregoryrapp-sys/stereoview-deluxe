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

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_ZOOM = 2.5;
const SWIPE_THRESHOLD = 50;
const SWIPE_VELOCITY_THRESHOLD = 0.3;

export function useStereoGestures(
  onSwipeLeft: () => void,
  onSwipeRight: () => void,
  containerWidth: number,
  containerHeight: number,
  isPortrait: boolean = false
) {
  const [state, setState] = useState<GestureState>({
    scale: 1,
    translateX: 0,
    translateY: 0,
  });

  const lastTouchRef = useRef<TouchPoint | null>(null);
  const lastTouchTimeRef = useRef<number>(0);
  const initialPinchDistanceRef = useRef<number>(0);
  const initialScaleRef = useRef<number>(1);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isPinchingRef = useRef(false);

  const clampTranslate = useCallback((x: number, y: number, scale: number) => {
    if (scale <= 1) {
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
    e.preventDefault();

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
      if (state.scale > 1) {
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

      // Check for swipe (only when not zoomed)
      if (touchStartRef.current && state.scale <= 1) {
        const endX = e.changedTouches[0].clientX;
        const endY = e.changedTouches[0].clientY;
        const endTime = Date.now();
        const rawDeltaX = endX - touchStartRef.current.x;
        const rawDeltaY = endY - touchStartRef.current.y;

        // Transform deltas for portrait mode rotation
        const { x: deltaX } = transformDelta(rawDeltaX, rawDeltaY);

        const deltaTime = endTime - touchStartRef.current.time;
        const velocity = Math.abs(deltaX) / deltaTime;

        if (Math.abs(deltaX) > SWIPE_THRESHOLD && velocity > SWIPE_VELOCITY_THRESHOLD) {
          if (deltaX > 0) {
            onSwipeRight();
          } else {
            onSwipeLeft();
          }
        }
      }

      // Check for double tap
      const now = Date.now();
      if (now - lastTouchTimeRef.current < 300) {
        // Double tap detected
        setState(prev => {
          if (prev.scale > 1) {
            // Zoom out
            return { scale: 1, translateX: 0, translateY: 0 };
          } else {
            // Zoom in
            return { scale: DOUBLE_TAP_ZOOM, translateX: 0, translateY: 0 };
          }
        });
      }
      lastTouchTimeRef.current = now;

      lastTouchRef.current = null;
      touchStartRef.current = null;
    } else if (e.touches.length === 1) {
      // Transition from pinch to single touch
      isPinchingRef.current = false;
      const touch = e.touches[0];
      lastTouchRef.current = { x: touch.clientX, y: touch.clientY };
    }
  }, [state.scale, onSwipeLeft, onSwipeRight, transformDelta]);

  const resetTransform = useCallback(() => {
    setState({ scale: 1, translateX: 0, translateY: 0 });
  }, []);

  return {
    scale: state.scale,
    translateX: state.translateX,
    translateY: state.translateY,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    resetTransform,
  };
}
