import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  addFullscreenChangeListener,
  exitPhotoFullscreen,
  isPhotoFullscreen,
  requestPhotoFullscreen,
} from '@/lib/fullscreen';

/**
 * Drives browser fullscreen for the photo viewer overlay.
 *
 * The request is made from a layout effect rather than from the click handler:
 * React flushes discrete events synchronously, so this still runs inside the
 * tap's user-activation window, but by then the overlay is mounted and visible.
 * Requesting from the click handler fails whenever the container is not yet in
 * the DOM.
 */
export function useViewerFullscreen(
  isOpen: boolean,
  containerRef: RefObject<HTMLElement>,
  onExitFullscreen?: () => void,
) {
  const didEnterRef = useRef(false);
  const onExitRef = useRef(onExitFullscreen);
  onExitRef.current = onExitFullscreen;

  useLayoutEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    requestPhotoFullscreen(containerRef.current).then((entered) => {
      if (!cancelled) didEnterRef.current = entered;
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, containerRef]);

  // Escape, the Android back gesture and the swipe-down chrome all leave
  // fullscreen without telling us. Close the viewer instead of leaving a black
  // overlay stranded underneath the restored browser UI.
  useEffect(() => {
    if (!isOpen) return;

    return addFullscreenChangeListener(() => {
      if (isPhotoFullscreen() || !didEnterRef.current) return;
      didEnterRef.current = false;
      onExitRef.current?.();
    });
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (!didEnterRef.current) return;
      didEnterRef.current = false;
      void exitPhotoFullscreen();
    };
  }, []);
}
