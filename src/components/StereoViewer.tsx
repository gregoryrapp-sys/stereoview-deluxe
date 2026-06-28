import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Photo } from '@/data/photos';
import { useStereoGestures } from '@/hooks/useStereoGestures';
import { useProcessedImage, usePreloadImages } from '@/hooks/useProcessedImage';
import { X, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AlbumRecord } from '@/types/database';

interface StereoViewerProps {
  photo: Photo;
  photos: Photo[];
  photoIndex: number;
  album: Pick<AlbumRecord, 'source_type' | 'dropbox_folder_url'> | null;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

export default function StereoViewer({
  photo,
  photos,
  photoIndex,
  album,
  onClose,
  onPrevious,
  onNext,
}: StereoViewerProps) {
  const [showControls, setShowControls] = useState(true);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  // Process the stereo image into left/right halves
  const { leftUrl, rightUrl, isLoading, error, dimensions } =  useProcessedImage(photo, album);

  // Preload adjacent images for smoother navigation
  const adjacentPhotos = useMemo(() => {
    const result: Photo[] = [];
    if (photoIndex > 0) {
      result.push(photos[photoIndex - 1]);
    }
    if (photoIndex < photos.length - 1) {
      result.push(photos[photoIndex + 1]);
    }
    return result;
  }, [photoIndex, photos]);

  usePreloadImages(adjacentPhotos, album);

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
      const startY = touchStartYRef.current;
      if (startY !== null && touch.clientY - startY > 100) {
        onClose();
      }
    }
    touchStartYRef.current = null;
  }, [scale, onClose]);

  const viewportWidth = containerSize.width / 2;
  const viewportHeight = containerSize.height;
  const containedImageScale = dimensions
    ? Math.min(viewportWidth / dimensions.width, viewportHeight / dimensions.height)
    : 1;
  const imageStageSize = dimensions
    ? {
        width: dimensions.width * containedImageScale,
        height: dimensions.height * containedImageScale,
      }
    : null;

  // Transform the actual image-sized stage, not the full viewport. Scaling from
  // the center keeps the stereo pair visually aligned at every zoom level.
  const imageTransform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  const imageTransformOrigin = 'center center';

  return (
    <div
      className={cn(
        "viewer-container h-full w-full flex items-center justify-center bg-black",
        swipeDirection === 'left' && "animate-slide-left",
        swipeDirection === 'right' && "animate-slide-right"
      )}
      onTouchStart={(e) => {
        touchStartYRef.current = e.touches[0]?.clientY ?? null;
        handleTouchStart(e);
      }}
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
          <div className="flex h-full w-1/2 items-center justify-center overflow-hidden">
            <div
              className="transition-transform duration-75"
              style={{
                width: imageStageSize?.width,
                height: imageStageSize?.height,
                transform: imageTransform,
                transformOrigin: imageTransformOrigin,
              }}
            >
              <img
                src={leftUrl}
                alt={`${photo.alt} (left)`}
                className="h-full w-full"
                draggable={false}
              />
            </div>
          </div>

          {/* Right viewport - displays right image */}
          <div className="flex h-full w-1/2 items-center justify-center overflow-hidden">
            <div
              className="transition-transform duration-75"
              style={{
                width: imageStageSize?.width,
                height: imageStageSize?.height,
                transform: imageTransform,
                transformOrigin: imageTransformOrigin,
              }}
            >
              <img
                src={rightUrl}
                alt={`${photo.alt} (right)`}
                className="h-full w-full"
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
      {Math.abs(scale - 1) > 0.01 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-secondary/60 px-3 py-1 text-sm text-muted-foreground backdrop-blur-sm">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}
