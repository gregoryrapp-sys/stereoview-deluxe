import { useEffect, useCallback, useRef, useState } from 'react';

export function useFullscreenLandscape(isActive: boolean, onExitFullscreen?: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wasFullscreenRef = useRef(false);
  const [isPortrait, setIsPortrait] = useState(false);

  // Check if we're in portrait orientation
  const checkOrientation = useCallback(() => {
    const portrait = window.innerHeight > window.innerWidth;
    setIsPortrait(portrait);
    return portrait;
  }, []);

  const enterFullscreen = useCallback(async () => {
    const element = containerRef.current;
    if (!element) return;

    try {
      // Check orientation before entering fullscreen
      checkOrientation();

      // Enter fullscreen
      if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else if ((element as any).webkitRequestFullscreen) {
        await (element as any).webkitRequestFullscreen();
      }

      wasFullscreenRef.current = true;

      // Try to lock orientation to landscape (works on Android Chrome, not iOS)
      try {
        const orientation = screen.orientation as any;
        if (orientation?.lock) {
          await orientation.lock('landscape');
        }
      } catch (e) {
        // Orientation lock not available - we'll use CSS rotation fallback
        console.log('Orientation lock not available, using CSS rotation fallback');
      }
    } catch (e) {
      console.log('Fullscreen not available:', e);
    }
  }, [checkOrientation]);

  const exitFullscreen = useCallback(async () => {
    try {
      // Unlock orientation first
      try {
        const orientation = screen.orientation as any;
        if (orientation?.unlock) {
          orientation.unlock();
        }
      } catch (e) {
        // Ignore orientation unlock errors
      }

      // Reset portrait state
      setIsPortrait(false);

      // Exit fullscreen
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if ((document as any).webkitFullscreenElement) {
        await (document as any).webkitExitFullscreen();
      }

      wasFullscreenRef.current = false;
    } catch (e) {
      console.log('Exit fullscreen error:', e);
    }
  }, []);

  // Listen for orientation changes while in fullscreen
  useEffect(() => {
    if (!isActive) return;

    const handleOrientationChange = () => {
      // Small delay to let the browser update dimensions
      setTimeout(() => {
        checkOrientation();
      }, 100);
    };

    // Listen for resize (covers most orientation changes)
    window.addEventListener('resize', handleOrientationChange);

    // Also listen for orientation change event
    window.addEventListener('orientationchange', handleOrientationChange);

    // Screen orientation API
    try {
      screen.orientation?.addEventListener('change', handleOrientationChange);
    } catch (e) {
      // Not supported
    }

    return () => {
      window.removeEventListener('resize', handleOrientationChange);
      window.removeEventListener('orientationchange', handleOrientationChange);
      try {
        screen.orientation?.removeEventListener('change', handleOrientationChange);
      } catch (e) {
        // Not supported
      }
    };
  }, [isActive, checkOrientation]);

  // Enter fullscreen when component becomes active
  useEffect(() => {
    if (isActive) {
      enterFullscreen();
    } else if (wasFullscreenRef.current) {
      exitFullscreen();
    }
  }, [isActive, enterFullscreen, exitFullscreen]);

  // Listen for fullscreen exit (e.g., user presses Escape)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);

      if (!isFullscreen && wasFullscreenRef.current && isActive) {
        wasFullscreenRef.current = false;
        setIsPortrait(false);

        // Unlock orientation when exiting fullscreen
        try {
          const orientation = screen.orientation as any;
          if (orientation?.unlock) {
            orientation.unlock();
          }
        } catch (e) {
          // Ignore
        }

        onExitFullscreen?.();
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [isActive, onExitFullscreen]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wasFullscreenRef.current) {
        // Unlock orientation on unmount
        try {
          const orientation = screen.orientation as any;
          if (orientation?.unlock) {
            orientation.unlock();
          }
        } catch (e) {
          // Ignore
        }
        exitFullscreen();
      }
    };
  }, [exitFullscreen]);

  return { containerRef, enterFullscreen, exitFullscreen, isPortrait };
}
