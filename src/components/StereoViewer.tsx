import { useState, useCallback, useEffect } from 'react';
import { Photo } from '@/data/photos';
import { useOrientation } from '@/hooks/useOrientation';
import { useStereoGestures } from '@/hooks/useStereoGestures';
import { X, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StereoViewerProps {
  photo: Photo;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

export default function StereoViewer({
  photo,
  onClose,
  onPrevious,
  onNext,
}: StereoViewerProps) {
  const isLandscape = useOrientation();
  const [showControls, setShowControls] = useState(true);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [swipeDirection, setSwipeDirection] = useState<'left' | 'right' | null>(null);

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
    containerSize.height
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

  // Orientation prompt for portrait mode
  if (!isLandscape) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[hsl(var(--viewer-bg))]">
        <div className="rotate-prompt flex flex-col items-center space-y-6 text-center">
          <RotateCcw className="h-20 w-20 text-muted-foreground" />
          <div className="space-y-2">
            <p className="text-xl font-light text-foreground">
              Rotate Your Phone
            </p>
            <p className="text-muted-foreground">
              Landscape mode required for stereoscopic viewing
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full bg-secondary/80 p-2 text-foreground"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
    );
  }

  // The transform to apply to each half (synchronized)
  const imageTransform = `scale(${scale}) translate(${translateX / scale}px, ${translateY / scale}px)`;

  return (
    <div
      className={cn(
        "viewer-container fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--viewer-bg))]",
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
      {/* Dual viewport stereoscopic display */}
      <div className="flex h-full w-full">
        {/* Left half */}
        <div className="h-full w-1/2 overflow-hidden">
          <div
            className="h-full w-[200%] origin-left transition-transform duration-75"
            style={{ transform: imageTransform }}
          >
            <img
              src={photo.src}
              alt={photo.alt}
              className="h-full w-full object-contain"
              draggable={false}
            />
          </div>
        </div>

        {/* Right half */}
        <div className="h-full w-1/2 overflow-hidden">
          <div
            className="h-full w-[200%] origin-right -translate-x-1/2 transition-transform duration-75"
            style={{ transform: `translateX(-50%) ${imageTransform}` }}
          >
            <img
              src={photo.src}
              alt={photo.alt}
              className="h-full w-full object-contain"
              draggable={false}
            />
          </div>
        </div>
      </div>

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
