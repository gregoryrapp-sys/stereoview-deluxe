import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';
import { Photo } from '@/data/photos';
import { usePreloadImages, useProcessedImage } from '@/hooks/useProcessedImage';
import { cn } from '@/lib/utils';
import type { AlbumRecord } from '@/types/database';

interface TwoDViewerProps {
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

export default function TwoDViewer({
  photo,
  photos,
  album,
  photoIndex,
  onClose,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
}: TwoDViewerProps) {
  const [showControls, setShowControls] = useState(true);
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const { leftUrl, isLoading, error } = useProcessedImage(photo, album);

  const adjacentPhotos = useMemo(() => {
    const result: Photo[] = [];
    if (photoIndex > 0) result.push(photos[photoIndex - 1]);
    if (photoIndex < photos.length - 1) result.push(photos[photoIndex + 1]);
    return result;
  }, [photoIndex, photos]);

  usePreloadImages(adjacentPhotos, album);

  useEffect(() => {
    setShowControls(true);
  }, [photo.id]);

  const handleTouchStart = (event: React.TouchEvent) => {
    touchStartX.current = event.touches[0].clientX;
    touchStartY.current = event.touches[0].clientY;
  };

  const handleTouchEnd = (event: React.TouchEvent) => {
    const touchEndX = event.changedTouches[0].clientX;
    const touchEndY = event.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX.current;
    const deltaY = touchEndY - touchStartY.current;
    const threshold = 50;

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
      if (deltaX < 0 && hasNext) {
        onNext();
      } else if (deltaX > 0 && hasPrevious) {
        onPrevious();
      }
    }

    if (deltaY > 100 && Math.abs(deltaY) > Math.abs(deltaX)) {
      onClose();
    }
  };

  return (
    <div
      className="flex h-full w-full items-center justify-center bg-black"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onClick={() => setShowControls((current) => !current)}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-white/60" />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="px-4 text-center text-red-400">{error}</p>
        </div>
      )}

      {leftUrl && (
        <img
          src={leftUrl}
          alt={photo.alt}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      )}

      <button
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className={cn(
          'absolute right-4 top-4 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200',
          showControls ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      >
        <X className="h-6 w-6" />
      </button>

      {hasPrevious && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onPrevious();
          }}
          className={cn(
            'absolute bottom-4 left-4 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200',
            showControls ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}

      {hasNext && (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onNext();
          }}
          className={cn(
            'absolute bottom-4 right-4 rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200',
            showControls ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
    </div>
  );
}
