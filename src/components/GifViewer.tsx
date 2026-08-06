import { useState, useRef, useEffect, useMemo } from 'react';
import { Photo } from '@/data/photos';
import { useProcessedImage, usePreloadImages } from '@/hooks/useProcessedImage';
import { X, ChevronLeft, ChevronRight, Loader2, Pause, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AlbumRecord } from '@/types/database';

interface GifViewerProps {
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

// Frame interval in ms (matches original GIF at 150ms)
const FRAME_INTERVAL = 150;

export default function GifViewer({
  photo,
  photos,
  photoIndex,
  album,
  onClose,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}: GifViewerProps) {
  const [showControls, setShowControls] = useState(true);
  const [showLeft, setShowLeft] = useState(true);
  const [isPlaying, setIsPlaying] = useState(true);
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);

  // Process the stereo image into left/right halves
  const { leftUrl, rightUrl, isLoading, error } = useProcessedImage(photo, album);

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

  // Animate between left and right frames (wiggle effect)
  useEffect(() => {
    if (!isPlaying || !leftUrl || !rightUrl) return;

    const interval = setInterval(() => {
      setShowLeft(prev => !prev);
    }, FRAME_INTERVAL);

    return () => clearInterval(interval);
  }, [isPlaying, leftUrl, rightUrl]);

  // Reset animation when photo changes
  useEffect(() => {
    setShowLeft(true);
    setIsPlaying(true);
  }, [photo.id]);

  const handleContainerClick = () => {
    setShowControls(prev => !prev);
  };

  const togglePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPlaying(prev => !prev);
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
      onClose();
    }
  };

  const currentUrl = showLeft ? leftUrl : rightUrl;

  return (
    <div
      className="h-full w-full flex items-center justify-center bg-black"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
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

      {/* Wiggle animation display - alternates between left and right */}
      {currentUrl && (
        <img
          src={currentUrl}
          alt={photo.alt}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      )}

      {/* Close button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          "absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200",
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        <X className="h-6 w-6" />
      </button>

      {/* Play/Pause button */}
      <button
        onClick={togglePlayPause}
        className={cn(
          "absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200",
          showControls ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
      >
        {isPlaying ? <Pause className="h-6 w-6" /> : <Play className="h-6 w-6" />}
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
