import { useEffect, useRef, useState } from 'react';
import { type DropboxFile, fetchDropboxPhotos } from '@/services/galleryService';

export type ListingStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface DropboxListing {
  files: DropboxFile[];
  /**
   * 'loading' from the very first render for a new folder - before the
   * request has even started - so a page never shows "0 photos" or "This
   * album is empty" for a folder that simply has not been listed yet.
   */
  status: ListingStatus;
}

const NO_FILES: DropboxFile[] = [];

/**
 * The files of a live Dropbox album's folder; null folder = not a live album.
 *
 * The listing is one request, so its result is the final count: it is either
 * not in yet (loading) or complete (ready). Results are tied to the folder
 * they were fetched for, so switching albums never shows the previous
 * album's files while the next one loads.
 */
export function useDropboxListing(
  folderUrl: string | null | undefined,
  onError?: (error: Error) => void,
): DropboxListing {
  const [result, setResult] = useState<{ folderUrl: string; files: DropboxFile[]; failed: boolean } | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!folderUrl) return;
    let cancelled = false;
    fetchDropboxPhotos(folderUrl).then(
      (files) => {
        if (!cancelled) setResult({ folderUrl, files, failed: false });
      },
      (error) => {
        if (cancelled) return;
        console.error('Failed to list Dropbox folder', error);
        setResult({ folderUrl, files: NO_FILES, failed: true });
        onErrorRef.current?.(error instanceof Error ? error : new Error(String(error)));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [folderUrl]);

  const current = folderUrl && result?.folderUrl === folderUrl ? result : null;
  return {
    files: current?.files ?? NO_FILES,
    status: !folderUrl ? 'idle' : !current ? 'loading' : current.failed ? 'error' : 'ready',
  };
}
