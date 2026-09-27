import { useEffect, useState } from 'react';
import { type DropboxFile, fetchDropboxThumbnailBlob, mapWithConcurrency } from '@/services/galleryService';

/** A live album of 70 photos must not open 70 Dropbox requests at once. */
const THUMBNAIL_CONCURRENCY = 6;

/**
 * Object URLs of cached Dropbox thumbnails for the files of one live album,
 * keyed by file id.
 *
 * Every grid that lists a live (not yet imported) Dropbox album reads from
 * here: the public album page, the signed-in gallery and album management.
 * The thumbnails come from the proxy's Storage cache after their first view,
 * so a grid costs one small request per tile instead of a multi-megabyte
 * original. The viewer still fetches the original of the photo being viewed.
 * Everything is revoked when the folder changes or the component unmounts.
 */
export function useDropboxThumbnails(
  folderUrl: string | null | undefined,
  files: DropboxFile[],
): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const filesKey = files.map((file) => `${file.id}:${file.client_modified ?? ''}`).join('|');

  useEffect(() => {
    setUrls({});
    if (!folderUrl || files.length === 0) return;

    let cancelled = false;
    const created: string[] = [];

    void mapWithConcurrency(files, THUMBNAIL_CONCURRENCY, async (file) => {
      if (cancelled) return;
      const blob = await fetchDropboxThumbnailBlob({
        folderUrl,
        fileName: file.name,
        modified: file.client_modified,
      });
      const url = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      created.push(url);
      setUrls((current) => ({ ...current, [file.id]: url }));
    });

    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
    // `files` is represented by filesKey so a re-created array with the same
    // contents does not refetch every thumbnail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderUrl, filesKey]);

  return urls;
}
