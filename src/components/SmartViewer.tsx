import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import type { Photo } from '@/data/photos';
import { useStereoGestures } from '@/hooks/useStereoGestures';
import { useProcessedImage, usePreloadImages } from '@/hooks/useProcessedImage';
import { cn } from '@/lib/utils';
import type { AlbumRecord } from '@/types/database';

interface SmartViewerProps {
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

type ViewMode = 'stereo' | '2d';

export default function SmartViewer({
  photo,
  photos,
  photoIndex,
  album,
  onClose,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}: SmartViewerProps) {
  const [mode, setMode] = useState<ViewMode>('stereo');
  const [showControls, setShowControls] = useState(true);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // --- Common Hooks ---
  const { leftUrl, rightUrl, isLoading, error, dimensions } = useProcessedImage(photo, album);

  const adjacentPhotos = useMemo(() => {
    const result: Photo[] = [];
    if (photoIndex > 0) result.push(photos[photoIndex - 1]);
    if (photoIndex < photos.length - 1) result.push(photos[photoIndex + 1]);
    return result;
  }, [photoIndex, photos]);

  usePreloadImages(adjacentPhotos, album);

  // --- Mode Switching Logic ---
  useEffect(() => {
    const handleResize = () => {
      setMode(window.innerHeight > window.innerWidth ? '2d' : 'stereo');
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // --- 2D Viewer Logic ---
  const touchStartX_2d = useRef(0);
  const touchStartY_2d = useRef(0);

  const handleTouchStart_2d = (event: React.TouchEvent) => {
    touchStartX_2d.current = event.touches[0].clientX;
    touchStartY_2d.current = event.touches[0].clientY;
  };

  const handleTouchEnd_2d = (event: React.TouchEvent) => {
    const touchEndX = event.changedTouches[0].clientX;
    const touchEndY = event.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX_2d.current;
    const deltaY = touchEndY - touchStartY_2d.current;
    const threshold = 50;

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
      if (deltaX < 0 && hasNext) onNext();
      else if (deltaX > 0 && hasPrevious) onPrevious();
    }

    if (deltaY > 100 && Math.abs(deltaY) > Math.abs(deltaX)) {
      onClose();
    }
  };

  // --- Stereo Viewer Logic ---
  useEffect(() => {
    const updateSize = () => setContainerSize({ width: window.innerWidth, height: window.innerHeight });
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Navigate immediately. This used to defer behind a 150ms timer to play
  // `animate-slide-left/right`, but those classes are not defined anywhere -
  // it was latency for no animation, and it let two quick swipes resolve
  // against the same photo index.
  const lastSwipeAtRef = useRef(0);

  const handleSwipeLeft = useCallback(() => {
    lastSwipeAtRef.current = Date.now();
    onNext();
  }, [onNext]);

  const handleSwipeRight = useCallback(() => {
    lastSwipeAtRef.current = Date.now();
    onPrevious();
  }, [onPrevious]);

  const {
    scale,
    translateX,
    translateY,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    resetTransform,
  } = useStereoGestures(handleSwipeLeft, handleSwipeRight, containerSize.width, containerSize.height, false);

  useEffect(() => {
    resetTransform();
    setShowControls(true);
  }, [photo.id, resetTransform]);

  const handleContainerClick = () => {
    if (mode === 'stereo' && scale > 1) return;
    // A swipe also produces a click. Without this guard every swipe toggles the
    // controls off, so the arrows end up pointer-events-none right when the
    // user reaches for them.
    if (Date.now() - lastSwipeAtRef.current < 300) return;
    setShowControls((current) => !current);
  };

  // Keyboard navigation. Desktop fullscreen is landscape, so it renders the
  // stereo view, where there is no other pointer affordance for paging.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        if (hasPrevious) onPrevious();
      } else if (event.key === 'ArrowRight') {
        if (hasNext) onNext();
      } else if (event.key === 'Escape') {
        onClose();
      } else {
        return;
      }
      event.preventDefault();
      setShowControls(true);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasPrevious, hasNext, onPrevious, onNext, onClose]);

  const viewportWidth = containerSize.width / 2;
  const viewportHeight = containerSize.height;
  const containedImageScale = dimensions ? Math.min(viewportWidth / dimensions.width, viewportHeight / dimensions.height) : 1;
  const imageStageSize = dimensions ? { width: dimensions.width * containedImageScale, height: dimensions.height * containedImageScale } : null;
  const imageTransform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;

  // --- Common UI Elements ---
  const closeButton = (
    <button
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      className={cn('absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200', showControls ? 'opacity-100' : 'pointer-events-none opacity-0')}
    >
      <X className="h-6 w-6" />
    </button>
  );

  const loadingIndicator = isLoading && (
    <div className="absolute inset-0 flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-white/60" />
    </div>
  );

  const errorIndicator = error && (
    <div className="absolute inset-0 flex items-center justify-center">
      <p className="px-4 text-center text-red-400">{error}</p>
    </div>
  );

  const prevButton = hasPrevious && (
    <button
      onClick={(e) => { e.stopPropagation(); onPrevious(); }}
      className={cn('absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200', showControls ? 'opacity-100' : 'pointer-events-none opacity-0')}
    >
      <ChevronLeft className="h-6 w-6" />
    </button>
  );

  const nextButton = hasNext && (
    <button
      onClick={(e) => { e.stopPropagation(); onNext(); }}
      className={cn('absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200', showControls ? 'opacity-100' : 'pointer-events-none opacity-0')}
    >
      <ChevronRight className="h-6 w-6" />
    </button>
  );

  // --- Render Logic ---
  if (mode === '2d') {
    return (
      <div
        className="viewer-container flex h-full w-full items-center justify-center bg-black"
        onTouchStart={handleTouchStart_2d}
        onTouchEnd={handleTouchEnd_2d}
        onClick={handleContainerClick}
      >
        {loadingIndicator}
        {errorIndicator}
        {leftUrl && <img src={leftUrl} alt={photo.alt} className="max-h-full max-w-full object-contain" draggable={false} />}
        {closeButton}
        {prevButton}
        {nextButton}
      </div>
    );
  }

  // Stereo Mode
  return (
    <div
      className="viewer-container h-full w-full flex items-center justify-center bg-black"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onClick={handleContainerClick}
    >
      {loadingIndicator}
      {errorIndicator}
      {leftUrl && rightUrl && (
        <div className="flex h-full w-full">
          <div className="flex h-full w-1/2 items-center justify-center overflow-hidden">
            <div className="transition-transform duration-75" style={{ width: imageStageSize?.width, height: imageStageSize?.height, transform: imageTransform, transformOrigin: 'center center' }}>
              <img src={leftUrl} alt={`${photo.alt} (left)`} className="h-full w-full" draggable={false} />
            </div>
          </div>
          <div className="flex h-full w-1/2 items-center justify-center overflow-hidden">
            <div className="transition-transform duration-75" style={{ width: imageStageSize?.width, height: imageStageSize?.height, transform: imageTransform, transformOrigin: 'center center' }}>
              <img src={rightUrl} alt={`${photo.alt} (right)`} className="h-full w-full" draggable={false} />
            </div>
          </div>
        </div>
      )}
      {closeButton}
      {prevButton}
      {nextButton}
      {Math.abs(scale - 1) > 0.01 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-secondary/60 px-3 py-1 text-sm text-muted-foreground backdrop-blur-sm">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}