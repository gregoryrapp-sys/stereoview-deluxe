import { useCallback, useState } from 'react';
import { DropboxPhoto } from '@/lib/types';
import { listDropboxPhotos } from '@/lib/dropbox';
import { getSettings } from '@/lib/storage';

interface UseDropboxPhotosResult {
  photos: DropboxPhoto[];
  isLoading: boolean;
  error: string | null;
  loadPhotos: (folderUrl: string) => Promise<DropboxPhoto[]>;
}

export const useDropboxPhotos = (): UseDropboxPhotosResult => {
  const [photos, setPhotos] = useState<DropboxPhoto[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPhotos = useCallback(async (folderUrl: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const settings = getSettings();
      const fetched = await listDropboxPhotos(settings.dropboxAccessToken, folderUrl);
      setPhotos(fetched);
      return fetched;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to load Dropbox photos.';
      setError(message);
      setPhotos([]);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, []);

  return { photos, isLoading, error, loadPhotos };
};
