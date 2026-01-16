import { useEffect, useCallback, useRef } from 'react';

export function useFullscreenLandscape(isActive: boolean, onExitFullscreen?: () => void) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wasFullscreenRef = useRef(false);

  const enterFullscreen = useCallback(async () => {
    const element = containerRef.current;
    if (!element) return;

    try {
      // Enter fullscreen
      if (element.requestFullscreen) {
        await element.requestFullscreen();
      } else if ((element as any).webkitRequestFullscreen) {
        await (element as any).webkitRequestFullscreen();
      }

      wasFullscreenRef.current = true;

      // Try to lock orientation to landscape
      try {
        const orientation = screen.orientation as any;
        if (orientation?.lock) {
          await orientation.lock('landscape');
        }
      } catch (e) {
        // Orientation lock may not be supported or allowed
        console.log('Orientation lock not available');
      }
    } catch (e) {
      console.log('Fullscreen not available:', e);
    }
  }, []);

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
        exitFullscreen();
      }
    };
  }, [exitFullscreen]);

  return { containerRef, enterFullscreen, exitFullscreen };
}
