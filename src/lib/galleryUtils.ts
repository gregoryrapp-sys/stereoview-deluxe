import type { GalleryPhoto } from '@/services/galleryService';
import type { AlbumRecord, EventRecord } from '@/types/database';

export type DropboxCoverMap = Record<string, { src: string; name: string }>;

export const COLLECTION_SORT_OPTIONS = [
  { value: 'title_asc', label: 'Name A-Z' },
  { value: 'title_desc', label: 'Name Z-A' },
  { value: 'created_at_desc', label: 'Date New-Old' },
  { value: 'created_at_asc', label: 'Date Old-New' },
];

export function getCoverPhoto(photos: GalleryPhoto[], coverPhotoId?: string | null): GalleryPhoto | null {
  return photos.find((photo) => photo.id === coverPhotoId) ?? photos[0] ?? null;
}

export function resolveEventCover(
  event: EventRecord,
  eventPhotos: GalleryPhoto[],
  dropboxCoverUrls: DropboxCoverMap,
): GalleryPhoto | null {
  // 1. Explicitly set Dropbox cover
  if (event.dropbox_cover_album_id && event.dropbox_cover_image_name) {
    const coverKey = `event-cover:${event.dropbox_cover_album_id}:${event.dropbox_cover_image_name}`;
    const coverInfo = dropboxCoverUrls[coverKey];
    if (coverInfo) {
      return {
        id: coverKey,
        src: coverInfo.src,
        alt: coverInfo.name,
        eventId: event.id,
        albumId: event.dropbox_cover_album_id,
      };
    }
  }

  // 2. Uploaded cover (explicit or fallback to first photo)
  const uploaded = getCoverPhoto(eventPhotos, event.cover_photo_id);
  if (uploaded) return uploaded;

  // 3. Default fetched Dropbox cover (first photo of first dropbox album)
  const defaultCover = dropboxCoverUrls[`event:${event.id}`];
  if (defaultCover) {
    return { id: `event-cover-${event.id}`, src: defaultCover.src, alt: defaultCover.name, eventId: event.id };
  }

  return null;
}

export function resolveAlbumCover(
  album: AlbumRecord,
  albumPhotos: GalleryPhoto[],
  dropboxCoverUrls: DropboxCoverMap,
): GalleryPhoto | null {
  if (album.source_type === 'dropbox' && album.dropbox_cover_image_name) {
    const coverInfo = dropboxCoverUrls[album.id];
    if (coverInfo) {
      return {
        id: `${album.id}-${album.dropbox_cover_image_name}`,
        src: coverInfo.src,
        alt: coverInfo.name,
        albumId: album.id,
        eventId: album.event_id,
      };
    }
    return null;
  }
  return getCoverPhoto(albumPhotos, album.cover_photo_id);
}
