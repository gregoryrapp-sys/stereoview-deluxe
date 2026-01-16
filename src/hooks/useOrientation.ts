import { useState, useEffect } from 'react';

export function useOrientation() {
  const [isLandscape, setIsLandscape] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth > window.innerHeight;
    }
    return true;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsLandscape(window.innerWidth > window.innerHeight);
    };

    const handleOrientationChange = () => {
      // Small delay to let the browser finish rotating
      setTimeout(handleResize, 100);
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, []);

  return isLandscape;
}
