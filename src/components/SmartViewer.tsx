import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X, Share2 } from 'lucide-react';
import type { Photo } from '@/data/photos';
import { useStereoGestures } from '@/hooks/useStereoGestures';
import { useProcessedImage, usePreloadImages } from '@/hooks/useProcessedImage';
import { useTransformSettle } from '@/hooks/useTransformSettle';
import { cn } from '@/lib/utils';
import type { AlbumRecord } from '@/types/database';

interface SmartViewerProps {
  photo: Photo;
  photos: Photo[];
  photoIndex: number;
  album:
    | (Pick<AlbumRecord, 'source_type' | 'dropbox_folder_url'> & { import_state?: AlbumRecord['import_state'] })
    | null;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

type ViewMode = 'stereo' | '2d';

/** Extension for a shared attachment, derived from the blob rather than the filename. */
const SHARE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

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
  // 2D mode renders the left eye only, so the right one is never worth decoding
  // or encoding. That is the dominant path on phones, where the viewer opens in
  // portrait, and it halves the per-photo work there.
  const eyes = mode === '2d' ? 'left' : 'both';
  const { leftUrl, rightUrl, isLoading, error, dimensions } = useProcessedImage(photo, album, { eyes });

  const adjacentPhotos = useMemo(() => {
    const result: Photo[] = [];
    if (photoIndex > 0) result.push(photos[photoIndex - 1]);
    if (photoIndex < photos.length - 1) result.push(photos[photoIndex + 1]);
    return result;
  }, [photoIndex, photos]);

  usePreloadImages(adjacentPhotos, album, { eyes });

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
  // A 3D transform plus will-change parks the stage on its own GPU layer, which
  // is what makes the gesture smooth. That layer is rasterized once and then
  // stretched, so holding it after the gesture leaves the image blurry while
  // zoomed. Once the transform settles, fall back to a 2D transform with no
  // hint and let the browser re-rasterize at the zoomed resolution.
  const isTransforming = useTransformSettle(`${scale}:${translateX}:${translateY}`);
  const imageTransform = isTransforming
    ? `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`
    : `translate(${translateX}px, ${translateY}px) scale(${scale})`;

  const handleShare = useCallback(async () => {
    if (!leftUrl) return;
    try {
      const res = await fetch(leftUrl);
      const blob = await res.blob();

      // Name the attachment generically. `photo.alt` is the source filename
      // (DSC-1234.jpg), which recipients have no reason to see, and it was also
      // being passed as the share sheet title. On Dropbox albums `alt` already
      // carries an extension, so appending `photo.extension` on top produced
      // "DSC-1234.jpg.jpg" - taking the extension from the blob's own MIME type
      // removes the filename and that double extension in one go.
      const mimeType = blob.type || 'image/jpeg';
      const file = new File([blob], `photo.${SHARE_EXTENSIONS[mimeType] ?? 'jpg'}`, {
        type: mimeType,
      });

      const shareApi = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };

      if (shareApi.canShare?.({ files: [file] })) {
        await shareApi.share?.({ files: [file] });
        return;
      }

      // Without file-share support, fall back to the page. The previous fallback
      // shared `leftUrl`, which is a multi-megabyte data: URL that no recipient
      // can open.
      if (shareApi.share) {
        await shareApi.share({ url: window.location.href });
      }
    } catch (e) {
      // AbortError just means the user dismissed the share sheet.
      if ((e as Error)?.name !== 'AbortError') {
        console.warn('Share failed', e);
      }
    }
  }, [leftUrl]);

  // --- Common UI Elements ---
  const closeButton = (
    <button
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      className={cn('absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200', showControls ? 'opacity-100' : 'pointer-events-none opacity-0')}
    >
      <X className="h-6 w-6" />
    </button>
  );

  const shareButton = (
    <button
      onClick={(e) => { e.stopPropagation(); handleShare(); }}
      className={cn('absolute left-4 top-4 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200', showControls ? 'opacity-100' : 'pointer-events-none opacity-0')}
      aria-label="Share"
    >
      <Share2 className="h-6 w-6" />
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
      className={cn('absolute bottom-4 left-4 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200 [padding-bottom:env(safe-area-inset-bottom)]', showControls ? 'opacity-100' : 'pointer-events-none opacity-0')}
    >
      <ChevronLeft className="h-6 w-6" />
    </button>
  );

  const nextButton = hasNext && (
    <button
      onClick={(e) => { e.stopPropagation(); onNext(); }}
      className={cn('absolute bottom-4 right-4 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200 [padding-bottom:env(safe-area-inset-bottom)]', showControls ? 'opacity-100' : 'pointer-events-none opacity-0')}
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
        {shareButton}
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
            <div className="viewer-stage" style={{ width: imageStageSize?.width, height: imageStageSize?.height, transform: imageTransform, willChange: isTransforming ? 'transform' : 'auto' }}>
              <img src={leftUrl} alt={`${photo.alt} (left)`} className="h-full w-full" draggable={false} />
            </div>
          </div>
          <div className="flex h-full w-1/2 items-center justify-center overflow-hidden">
            <div className="viewer-stage" style={{ width: imageStageSize?.width, height: imageStageSize?.height, transform: imageTransform, willChange: isTransforming ? 'transform' : 'auto' }}>
              <img src={rightUrl} alt={`${photo.alt} (right)`} className="h-full w-full" draggable={false} />
            </div>
          </div>
        </div>
      )}
      {closeButton}
      {shareButton}
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