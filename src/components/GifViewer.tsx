import { useState, useCallback, useRef } from 'react';
import { Photo } from '@/data/photos';
import { useFullscreenLandscape } from '@/hooks/useFullscreenLandscape';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface GifViewerProps {
  photo: Photo;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

export default function GifViewer({
  photo,
  onClose,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}: GifViewerProps) {
  const [showControls, setShowControls] = useState(true);
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);

  // Fullscreen and landscape orientation lock
  const { containerRef, exitFullscreen, isPortrait } = useFullscreenLandscape(true, onClose);

  const handleClose = useCallback(async () => {
    await exitFullscreen();
    onClose();
  }, [exitFullscreen, onClose]);

  const handleContainerClick = () => {
    setShowControls(prev => !prev);
  };

  // Simple swipe handling
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX.current;
    const deltaY = touchEndY - touchStartY.current;

    // Swipe threshold
    const threshold = 50;

    // Check if horizontal swipe is dominant
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
      if (deltaX < 0 && hasNext) {
        onNext();
      } else if (deltaX > 0 && hasPrevious) {
        onPrevious();
      }
    }

    // Swipe down to close
    if (deltaY > 100 && Math.abs(deltaY) > Math.abs(deltaX)) {
      handleClose();
    }
  };

  // Calculate rotation styles for portrait mode (CSS fallback when orientation lock unavailable)
  const rotationStyles = isPortrait
    ? {
        transform: 'rotate(90deg)',
        transformOrigin: 'center center',
        width: `${window.innerHeight}px`,
        height: `${window.innerWidth}px`,
        position: 'fixed' as const,
        top: '50%',
        left: '50%',
        marginTop: `-${window.innerWidth / 2}px`,
        marginLeft: `-${window.innerHeight / 2}px`,
      }
    : {};

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black"
      style={rotationStyles}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={handleContainerClick}
    >
      {/* GIF display - fills screen while maintaining aspect ratio */}
      <img
        src={photo.srcGif}
        alt={photo.alt}
        className="max-h-full max-w-full object-contain"
        draggable={false}
      />

      {/* Close button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleClose();
        }}
        className={cn(
          "absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200",
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        <X className="h-6 w-6" />
      </button>

      {/* Navigation arrows */}
      {hasPrevious && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPrevious();
          }}
          className={cn(
            "absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200",
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      {hasNext && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          className={cn(
            "absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200",
            showControls ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
    </div>
  );
}
