import { useEffect, useRef, useState } from 'react';
import type { AlbumRecord, EventRecord } from '@/types/database';
import { isLiveDropboxAlbum } from '@/lib/albumSource';
import { fetchDropboxFolderCover, fetchDropboxThumbnailBlob } from '@/services/galleryService';
import type { DropboxCoverMap } from '@/lib/galleryUtils';

/**
 * Fetches and caches Dropbox cover images for albums and events of live (not
 * yet imported) Dropbox albums. Imported albums never come here: their covers
 * are ordinary photos with thumbnails in Storage.
 *
 * - `albumCoverSources`: albums to resolve explicit album covers for (e.g. the
 *   albums of the currently viewed event).
 * - `events` / `albums`: the full gallery data used to resolve both explicit
 *   event covers and default covers (first photo of the first Dropbox album).
 *
 * Every cover is a thumbnail from the proxy's Storage cache (about 60 KB),
 * held as an object URL and revoked on unmount. Direct Dropbox links were
 * used before; they carry the full original and Dropbox serves them with
 * `application/binary` + nosniff, which an <img> may refuse.
 *
 * Returns the cover map, a setter so callers can register extra covers (e.g.
 * profile covers in the management page), and `trackObjectUrl` so those
 * callers' object URLs are revoked together with the hook's own.
 */
export function useDropboxCovers(
  events: EventRecord[],
  albums: AlbumRecord[],
  albumCoverSources: AlbumRecord[],
): {
  dropboxCoverUrls: DropboxCoverMap;
  setDropboxCoverUrls: React.Dispatch<React.SetStateAction<DropboxCoverMap>>;
  trackObjectUrl: (url: string) => string;
} {
  const [dropboxCoverUrls, setDropboxCoverUrls] = useState<DropboxCoverMap>({});

  // Every effect below re-runs on `dropboxCoverUrls` and selects its work with
  // `!dropboxCoverUrls[key]`. A fetch that FAILS never writes that key, so a
  // sibling's success re-renders and re-fires the failure immediately, with no
  // backoff - the worst possible behaviour during the Dropbox 429 episode these
  // effects can themselves cause. This ref makes each key at-most-once per
  // mount, so the effects converge instead of drumming on a rate-limited API.
  const attempted = useRef<Set<string>>(new Set());
  const claim = (key: string): boolean => {
    if (attempted.current.has(key)) return false;
    attempted.current.add(key);
    return true;
  };

  const objectUrls = useRef<string[]>([]);
  const trackObjectUrl = (url: string): string => {
    objectUrls.current.push(url);
    return url;
  };
  useEffect(
    () => () => {
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current = [];
    },
    [],
  );

  const coverUrl = async (folderUrl: string, fileName: string): Promise<string> =>
    trackObjectUrl(URL.createObjectURL(await fetchDropboxThumbnailBlob({ folderUrl, fileName })));

  useEffect(() => {
    if (!albumCoverSources || albumCoverSources.length === 0) return;

    const coversToFetch = albumCoverSources.filter(
      (album) =>
        isLiveDropboxAlbum(album) &&
        album.dropbox_cover_image_name &&
        album.dropbox_folder_url &&
        !dropboxCoverUrls[album.id] &&
        claim(`album:${album.id}`),
    );

    if (coversToFetch.length === 0) return;

    const fetchCovers = async () => {
      const results = await Promise.allSettled(
        coversToFetch.map(async (album) => ({
          albumId: album.id,
          src: await coverUrl(album.dropbox_folder_url!, album.dropbox_cover_image_name!),
          name: album.dropbox_cover_image_name!,
        })),
      );

      const newCoverUrls: DropboxCoverMap = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          newCoverUrls[result.value.albumId] = { src: result.value.src, name: result.value.name };
        } else {
          console.error('Failed to fetch a Dropbox cover photo:', result.reason);
        }
      });

      if (Object.keys(newCoverUrls).length > 0) {
        setDropboxCoverUrls((prev) => ({ ...prev, ...newCoverUrls }));
      }
    };

    fetchCovers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [albumCoverSources, dropboxCoverUrls]);

  useEffect(() => {
    if (!events || events.length === 0) return;

    const eventsToFindCoversFor = events.filter(
      (e) => !e.cover_photo_id && !dropboxCoverUrls[`event:${e.id}`] && claim(`event:${e.id}`),
    );

    if (eventsToFindCoversFor.length === 0) return;

    const fetchEventCovers = async () => {
      const results = await Promise.allSettled(
        eventsToFindCoversFor.map(async (event) => {
          const dropboxAlbum = albums.find(
            (a) => a.event_id === event.id && isLiveDropboxAlbum(a) && a.dropbox_folder_url,
          );
          if (!dropboxAlbum) return null;
          // One listing to learn the first file's name, then the cached thumbnail.
          const first = await fetchDropboxFolderCover(dropboxAlbum.dropbox_folder_url!);
          if (!first) return null;
          return {
            eventId: event.id,
            src: await coverUrl(dropboxAlbum.dropbox_folder_url!, first.name),
            name: first.name,
          };
        }),
      );

      const newCoverUrls: DropboxCoverMap = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          newCoverUrls[`event:${result.value.eventId}`] = { src: result.value.src, name: result.value.name };
        } else if (result.status === 'rejected') {
          console.error('Failed to fetch a Dropbox event cover photo:', result.reason);
        }
      });

      if (Object.keys(newCoverUrls).length > 0) {
        setDropboxCoverUrls((prev) => ({ ...prev, ...newCoverUrls }));
      }
    };

    fetchEventCovers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, albums, dropboxCoverUrls]);

  useEffect(() => {
    if (!events.length) return;

    const coversToFetch = events.filter(
      (event) =>
        event.dropbox_cover_album_id &&
        event.dropbox_cover_image_name &&
        !dropboxCoverUrls[`event-cover:${event.dropbox_cover_album_id}:${event.dropbox_cover_image_name}`] &&
        claim(`event-cover:${event.dropbox_cover_album_id}:${event.dropbox_cover_image_name}`),
    );

    if (coversToFetch.length === 0) return;

    const fetchCovers = async () => {
      const results = await Promise.allSettled(
        coversToFetch.map(async (event) => {
          const album = albums.find((a) => a.id === event.dropbox_cover_album_id);
          if (!album || !album.dropbox_folder_url) return null;
          return {
            key: `event-cover:${event.dropbox_cover_album_id}:${event.dropbox_cover_image_name}`,
            src: await coverUrl(album.dropbox_folder_url, event.dropbox_cover_image_name!),
            name: event.dropbox_cover_image_name!,
          };
        }),
      );

      const newCoverUrls: DropboxCoverMap = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value) {
          newCoverUrls[result.value.key] = { src: result.value.src, name: result.value.name };
        }
      });
      if (Object.keys(newCoverUrls).length > 0) {
        setDropboxCoverUrls((prev) => ({ ...prev, ...newCoverUrls }));
      }
    };

    fetchCovers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, albums, dropboxCoverUrls]);

  return { dropboxCoverUrls, setDropboxCoverUrls, trackObjectUrl };
}
