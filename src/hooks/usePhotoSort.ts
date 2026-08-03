import { useMemo } from 'react';
import type { GalleryPhoto } from '@/services/galleryService';

export function usePhotoSort(activePhotos: GalleryPhoto[], sortValue: string): GalleryPhoto[] {
  return useMemo(() => {
    const separatorIndex = sortValue.lastIndexOf('_');
    const sortKey = sortValue.slice(0, separatorIndex);
    const sortDirection = sortValue.slice(separatorIndex + 1);

    return [...activePhotos].sort((a, b) => {
      let comparison = 0;
      if (sortKey === 'created_at') {
        comparison = String(a.created_at ?? '').localeCompare(String(b.created_at ?? ''), undefined, { numeric: true });
      } else {
        comparison = (a.alt || '').localeCompare(b.alt || '', undefined, { numeric: true });
      }
      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [activePhotos, sortValue]);
}
