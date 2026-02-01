import { useState, useCallback, useEffect, useMemo } from 'react';
import { Photo, photos } from '@/data/photos';
import { useStereoGestures } from '@/hooks/useStereoGestures';
import { useProcessedImage, usePreloadImages } from '@/hooks/useProcessedImage';
import { X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StereoViewerProps {
  photo: Photo;
  photoIndex: number;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  photoSet?: Photo[];
}

export default function StereoViewer({
  photo,
  photoIndex,
  onClose,
  onPrevious,
  onNext,
  photoSet,
}: StereoViewerProps) {
  const [showControls, setShowControls] = useState(true);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const activePhotos = photoSet ?? photos;

  // Process the stereo image into left/right halves
  const { leftUrl, rightUrl, isLoading, error } = useProcessedImage(photo.src);

  // Preload adjacent images for smoother navigation
  const adjacentSrcs = useMemo(() => {
    const srcs: string[] = [];
    if (photoIndex > 0) {
      srcs.push(activePhotos[photoIndex - 1].src);
    }
    if (photoIndex < activePhotos.length - 1) {
      srcs.push(activePhotos[photoIndex + 1].src);
    }
    return srcs;
  }, [activePhotos, photoIndex]);

  usePreloadImages(adjacentSrcs);

  // Update container size on mount and resize
  useEffect(() => {
    const updateSize = () => {
      setContainerSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const handleSwipeLeft = useCallback(() => {
    setSwipeDirection('left');
    setTimeout(() => {
      onNext();
      setSwipeDirection(null);
    }, 150);
  }, [onNext]);

  const handleSwipeRight = useCallback(() => {
    setSwipeDirection('right');
    setTimeout(() => {
      onPrevious();
      setSwipeDirection(null);
    }, 150);
  }, [onPrevious]);

  const {
    scale,
    translateX,
    translateY,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    resetTransform,
  } = useStereoGestures(
    handleSwipeLeft,
    handleSwipeRight,
    containerSize.width,
    containerSize.height,
    false // not portrait rotated
  );

  // Reset transform when photo changes
  useEffect(() => {
    resetTransform();
  }, [photo.id, resetTransform]);

  // Toggle controls on tap (when not zoomed)
  const handleContainerClick = () => {
    if (scale <= 1) {
      setShowControls(prev => !prev);
    }
  };

  // Handle swipe down to close
  const handleSwipeDown = useCallback((e: React.TouchEvent) => {
    if (scale <= 1) {
      const touch = e.changedTouches[0];
      const startY = (e as any).startY;
      if (startY !== undefined && touch.clientY - startY > 100) {
        onClose();
      }
    }
  }, [scale, onClose]);

  // The transform to apply to each half (synchronized)
  const imageTransform = `scale(${scale}) translate(${translateX / scale}px, ${translateY / scale}px)`;

  return (
    <div
      className={cn(
        "viewer-container h-full w-full flex items-center justify-center bg-black",
        swipeDirection === 'left' && "animate-slide-left",
        swipeDirection === 'right' && "animate-slide-right"
      )}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={(e) => {
        handleTouchEnd(e);
        handleSwipeDown(e);
      }}
      onClick={handleContainerClick}
    >
      {/* Loading state */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/60" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-red-400 text-center px-4">{error}</p>
        </div>
      )}

      {/* Dual viewport stereoscopic display */}
      {leftUrl && rightUrl && (
        <div className="flex h-full w-full">
          {/* Left viewport - displays left image */}
          <div className="h-full w-1/2 overflow-hidden">
            <div
              className="h-full w-full transition-transform duration-75"
              style={{ transform: imageTransform }}
            >
              <img
                src={leftUrl}
                alt={`${photo.alt} (left)`}
                className="h-full w-full object-contain"
                draggable={false}
              />
            </div>
          </div>

          {/* Right viewport - displays right image */}
          <div className="h-full w-1/2 overflow-hidden">
            <div
              className="h-full w-full transition-transform duration-75"
              style={{ transform: imageTransform }}
            >
              <img
                src={rightUrl}
                alt={`${photo.alt} (right)`}
                className="h-full w-full object-contain"
                draggable={false}
              />
            </div>
          </div>
        </div>
      )}

      {/* Close button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          "absolute right-4 top-4 rounded-full bg-secondary/60 p-3 text-foreground backdrop-blur-sm transition-opacity duration-200",
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        <X className="h-6 w-6" />
      </button>

      {/* Zoom indicator */}
      {scale > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-secondary/60 px-3 py-1 text-sm text-muted-foreground backdrop-blur-sm">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}
