import { Loader2 } from 'lucide-react';
import type { Photo } from '@/data/photos';
import { useProcessedImage } from '@/hooks/useProcessedImage';
import type { AlbumRecord } from '@/types/database';


interface StereoThumbnailProps {
  photo: Photo;
  album: AlbumRecord | null;
}

export default function StereoThumbnail({ photo,album }: StereoThumbnailProps) {
  const { leftUrl, isLoading } = useProcessedImage(photo, album);

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-secondary">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <img
      src={leftUrl ?? photo.src}
      alt={photo.alt}
      className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
      loading="lazy"
    />
  );
}
