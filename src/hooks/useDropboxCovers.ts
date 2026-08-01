import { useEffect, useState } from 'react';
import type { AlbumRecord, EventRecord } from '@/types/database';
import { fetchDropboxPhoto, fetchDropboxPhotos } from '@/services/galleryService';
import type { DropboxCoverMap } from '@/lib/galleryUtils';

/**
 * Fetches and caches Dropbox cover images for albums and events.
 *
 * - `albumCoverSources`: albums to resolve explicit album covers for (e.g. the
 *   albums of the currently viewed event).
 * - `events` / `albums`: the full gallery data used to resolve both explicit
 *   event covers and default covers (first photo of the first Dropbox album).
 *
 * Returns the cover map plus a setter so callers can register extra covers
 * (e.g. profile covers in the management page).
 */
export function useDropboxCovers(
  events: EventRecord[],
  albums: AlbumRecord[],
  albumCoverSources: AlbumRecord[],
): { dropboxCoverUrls: DropboxCoverMap; setDropboxCoverUrls: React.Dispatch<React.SetStateAction<DropboxCoverMap>> } {
  const [dropboxCoverUrls, setDropboxCoverUrls] = useState<DropboxCoverMap>({});

  useEffect(() => {
    if (!albumCoverSources || albumCoverSources.length === 0) return;

    const coversToFetch = albumCoverSources.filter(
      (album) =>
        album.source_type === 'dropbox' &&
        album.dropbox_cover_image_name &&
        album.dropbox_folder_url &&
        !dropboxCoverUrls[album.id],
    );

    if (coversToFetch.length === 0) return;

    const fetchCovers = async () => {
      const results = await Promise.allSettled(
        coversToFetch.map(async (album) => {
          const photo = await fetchDropboxPhoto(album.dropbox_folder_url!, album.dropbox_cover_image_name!);
          return { albumId: album.id, src: photo.src, name: photo.name };
        }),
      );

      const newCoverUrls: DropboxCoverMap = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.src) {
          newCoverUrls[result.value.albumId] = { src: result.value.src, name: result.value.name };
        } else if (result.status === 'rejected') {
          console.error('Failed to fetch a Dropbox cover photo:', result.reason);
        }
      });

      if (Object.keys(newCoverUrls).length > 0) {
        setDropboxCoverUrls((prev) => ({ ...prev, ...newCoverUrls }));
      }
    };

    fetchCovers();
  }, [albumCoverSources, dropboxCoverUrls]);

  useEffect(() => {
    if (!events || events.length === 0) return;

    const eventsToFindCoversFor = events.filter((e) => !e.cover_photo_id && !dropboxCoverUrls[`event:${e.id}`]);

    if (eventsToFindCoversFor.length === 0) return;

    const fetchEventCovers = async () => {
      const results = await Promise.allSettled(
        eventsToFindCoversFor.map(async (event) => {
          const dropboxAlbum = albums.find(
            (a) => a.event_id === event.id && a.source_type === 'dropbox' && a.dropbox_folder_url,
          );
          if (!dropboxAlbum) return null;
          const photos = await fetchDropboxPhotos(dropboxAlbum.dropbox_folder_url!);
          if (photos.length > 0) {
            return { eventId: event.id, src: photos[0].src, name: photos[0].name };
          }
          return null;
        }),
      );

      const newCoverUrls: DropboxCoverMap = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value?.src) {
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
  }, [events, albums, dropboxCoverUrls]);

  useEffect(() => {
    if (!events.length) return;

    const coversToFetch = events.filter(
      (event) =>
        event.dropbox_cover_album_id &&
        event.dropbox_cover_image_name &&
        !dropboxCoverUrls[`event-cover:${event.dropbox_cover_album_id}:${event.dropbox_cover_image_name}`],
    );

    if (coversToFetch.length === 0) return;

    const fetchCovers = async () => {
      const results = await Promise.allSettled(
        coversToFetch.map(async (event) => {
          const album = albums.find((a) => a.id === event.dropbox_cover_album_id);
          if (!album || !album.dropbox_folder_url) return null;
          const photo = await fetchDropboxPhoto(album.dropbox_folder_url, event.dropbox_cover_image_name!);
          return {
            key: `event-cover:${event.dropbox_cover_album_id}:${event.dropbox_cover_image_name}`,
            src: photo.src,
            name: photo.name,
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
  }, [events, albums, dropboxCoverUrls]);

  return { dropboxCoverUrls, setDropboxCoverUrls };
}
