import { useMemo, useState, useEffect } from 'react';
import { ArrowUp, Cloud, FolderOpen, Images } from 'lucide-react';
import type { AlbumRecord } from '@/types/database';
import { fetchDropboxPhotos, type GalleryData, type GalleryPhoto } from '@/services/galleryService';
import StereoThumbnail from '@/components/StereoThumbnail';
import ThumbnailGrid from '@/components/ThumbnailGrid';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

function getCoverPhoto(photos: GalleryPhoto[], coverPhotoId?: string | null) {
  return photos.find((photo) => photo.id === coverPhotoId) ?? photos[0] ?? null;
}

interface ProfileCoverPhotoPickerProps {
  galleryData: GalleryData;
  onSelect: (photo: GalleryPhoto | null) => void;
  currentCoverPhotoId: string | null;
  dropboxCoverUrls?: Record<string, { src: string; name: string }>;
}

export function ProfileCoverPhotoPicker({
  galleryData,
  onSelect,
  currentCoverPhotoId,
  dropboxCoverUrls,
}: ProfileCoverPhotoPickerProps) {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [dropboxPhotos, setDropboxPhotos] = useState<GalleryPhoto[]>([]);
  const [isDropboxLoading, setIsDropboxLoading] = useState(false);
  const [localDropboxCoverUrls, setLocalDropboxCoverUrls] = useState<Record<string, { src: string; name: string }>>({});

  const allDropboxCoverUrls = useMemo(() => ({ ...dropboxCoverUrls, ...localDropboxCoverUrls }), [
    dropboxCoverUrls,
    localDropboxCoverUrls,
  ]);

  // Fetch fallback covers for dropbox albums that don't have an explicit one
  useEffect(() => {
    const albumsToFetch = galleryData.albums.filter(
      (album) =>
        album.source_type === 'dropbox' &&
        !album.dropbox_cover_image_name &&
        album.dropbox_folder_url &&
        !allDropboxCoverUrls[album.id],
    );

    if (albumsToFetch.length === 0) return;

    let cancelled = false;
    const fetchCovers = async () => {
      const results = await Promise.allSettled(
        albumsToFetch.map(async (album) => {
          const photos = await fetchDropboxPhotos(album.dropbox_folder_url!);
          if (photos.length > 0) {
            return { albumId: album.id, src: photos[0].src, name: photos[0].name };
          }
          return null;
        }),
      );

      if (cancelled) return;

      const newCoverUrls: Record<string, { src: string; name: string }> = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value?.src) {
          newCoverUrls[result.value.albumId] = { src: result.value.src, name: result.value.name };
        }
      });

      if (Object.keys(newCoverUrls).length > 0) {
        setLocalDropboxCoverUrls((prev) => ({ ...prev, ...newCoverUrls }));
      }
    };

    fetchCovers();
    return () => {
      cancelled = true;
    };
  }, [galleryData.albums, allDropboxCoverUrls]);

  const photosByAlbum = useMemo(() => {
    return galleryData.photos.reduce<Record<string, GalleryPhoto[]>>((groups, photo) => {
      if (!photo.albumId) return groups;
      groups[photo.albumId] = [...(groups[photo.albumId] ?? []), photo];
      return groups;
    }, {});
  }, [galleryData.photos]);

  const photosByEvent = useMemo(() => {
    return galleryData.photos.reduce<Record<string, GalleryPhoto[]>>((groups, photo) => {
      if (!photo.eventId) return groups;
      groups[photo.eventId] = [...(groups[photo.eventId] ?? []), photo];
      return groups;
    }, {});
  }, [galleryData.photos]);

  const selectedEvent = useMemo(
    () => galleryData.events.find((event) => event.id === selectedEventId) ?? null,
    [galleryData.events, selectedEventId],
  );

  const selectedAlbum = useMemo(
    () => galleryData.albums.find((album) => album.id === selectedAlbumId) ?? null,
    [galleryData.albums, selectedAlbumId],
  );

  const activeAlbums = useMemo(
    () => galleryData.albums.filter((album) => album.event_id === selectedEventId),
    [galleryData.albums, selectedEventId],
  );

  // Fetch photos when a dropbox album is selected
  const activePhotos = useMemo(
    () => {
      if (selectedAlbum?.source_type === 'dropbox') {
        return dropboxPhotos.map((p) => ({ ...p, isDropbox: true, album: selectedAlbum, albumId: selectedAlbum.id }));
      }
      return galleryData.photos.filter((photo) => photo.albumId === selectedAlbumId);
    },
    [galleryData.photos, selectedAlbumId, selectedAlbum, dropboxPhotos],
  );

  useEffect(() => {
    if (!selectedAlbum || selectedAlbum.source_type !== 'dropbox' || !selectedAlbum.dropbox_folder_url) {
      setDropboxPhotos([]);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setIsDropboxLoading(true);
      try {
        const files = await fetchDropboxPhotos(selectedAlbum.dropbox_folder_url!);
        if (!cancelled) {
          const photos: GalleryPhoto[] = files.map((file) => ({ id: file.id, src: file.src, alt: file.name }));
          setDropboxPhotos(photos);
        }
      } catch (error) {
        toast({ title: 'Could not load Dropbox photos', description: error instanceof Error ? error.message : 'Unknown error', variant: 'destructive' });
        if (!cancelled) setDropboxPhotos([]);
      } finally {
        if (!cancelled) setIsDropboxLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedAlbum]);

  const albumCountsByEvent = useMemo(() => {
    return galleryData.albums.reduce<Record<string, number>>((counts, album) => {
      counts[album.event_id] = (counts[album.event_id] ?? 0) + 1;
      return counts;
    }, {});
  }, [galleryData.albums]);

  const level = selectedAlbumId ? 'photos' : selectedEventId ? 'albums' : 'events';
  const title = selectedAlbum?.title ?? selectedEvent?.title ?? 'Events';

  return (
    <div className="grid min-h-0 flex-1 grid-rows-[auto_1fr] overflow-y-auto p-1">
      <div>
        {level !== 'events' && (
          <Button
            variant="ghost"
            className="mb-2 gap-2"
            onClick={() => {
              if (selectedAlbumId) {
                setSelectedAlbumId(null);
              } else if (selectedEventId) {
                setSelectedEventId(null);
              }
            }}
          >
            <ArrowUp className="h-4 w-4" />
            Up to {selectedAlbumId ? 'albums' : 'events'}
          </Button>
        )}
        <h3 className="text-lg font-medium">{title}</h3>
      </div>

      <div className="mt-4 min-h-0 overflow-y-auto">
        {level === 'events' && (
          <ThumbnailGrid
            items={galleryData.events}
            sortOptions={[
              { value: 'title', label: 'Name' },
              { value: 'created_at', label: 'Creation Date' },
            ]}
            emptyMessage="No events found."
            renderItem={(event) => {
              const eventPhotos = photosByEvent[event.id] ?? [];
              let eventCover: GalleryPhoto | null = null;

              // 1. Check for explicitly set Dropbox cover
              if (event.dropbox_cover_album_id && event.dropbox_cover_image_name) {
                const coverKey = `event-cover:${event.dropbox_cover_album_id}:${event.dropbox_cover_image_name}`;
                const coverInfo = allDropboxCoverUrls?.[coverKey];
                if (coverInfo) {
                  eventCover = {
                    id: coverKey,
                    src: coverInfo.src,
                    alt: coverInfo.name,
                    eventId: event.id,
                    albumId: event.dropbox_cover_album_id,
                  };
                }
              }

              // 2. If no explicit Dropbox cover, check for uploaded cover (explicit or fallback to first)
              if (!eventCover) {
                eventCover = getCoverPhoto(eventPhotos, event.cover_photo_id);
              }

              // 3. If still no cover, check for a default fetched Dropbox cover
              if (!eventCover) {
                const coverInfo = allDropboxCoverUrls?.[`event:${event.id}`];
                if (coverInfo) {
                  eventCover = { id: `event-cover-${event.id}`, src: coverInfo.src, alt: coverInfo.name, eventId: event.id };
                }
              }

              return (
                <button
                  key={event.id}
                  onClick={() => setSelectedEventId(event.id)}
                  className="group overflow-hidden rounded-md border border-border bg-card text-left transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <span className="block aspect-[3/2] bg-secondary">
                    {eventCover ? <StereoThumbnail photo={eventCover} /> : (
                      <span className="flex h-full w-full items-center justify-center">
                        <FolderOpen className="h-6 w-6 text-muted-foreground" />
                      </span>
                    )}
                  </span>
                  <span className="block min-w-0 p-2">
                    <span className="block truncate text-sm font-medium">{event.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {albumCountsByEvent[event.id] ?? 0} albums
                    </span>
                  </span>
                </button>
              );
            }}
          />
        )}

        {level === 'albums' && (
          <ThumbnailGrid
            items={activeAlbums}
            sortOptions={[
              { value: 'title', label: 'Name' },
              { value: 'created_at', label: 'Creation Date' },
            ]}
            emptyMessage="This event has no albums."
            renderItem={(album) => {
              const photos = photosByAlbum[album.id] ?? [];
              let albumCover: GalleryPhoto | null = null;
              
              if (album.source_type === 'dropbox') {
                // For dropbox albums, the cover URL (explicit or fallback) is in allDropboxCoverUrls
                const coverInfo = allDropboxCoverUrls?.[album.id];
                if (coverInfo) {
                  albumCover = {
                    id: `${album.id}-${coverInfo.name}`,
                    src: coverInfo.src,
                    alt: coverInfo.name,
                    albumId: album.id,
                    eventId: album.event_id,
                  };
                }
              } else {
                // For upload albums, find the cover from the photos list
                albumCover = getCoverPhoto(photos, album.cover_photo_id);
              }

              return (
                <button
                  key={album.id}
                  onClick={() => setSelectedAlbumId(album.id)}
                  className="group overflow-hidden rounded-md border border-border bg-card text-left transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <span className="block aspect-[3/2] bg-secondary">
                    {albumCover ? <StereoThumbnail photo={albumCover} /> : (
                      <span className="flex h-full w-full items-center justify-center">
                        <Images className="h-6 w-6 text-muted-foreground" />
                      </span>
                    )}
                  </span>
                  <span className="block min-w-0 p-2">
                    <span className="block truncate text-sm font-medium">{album.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">{photos.length} photos</span>
                  </span>
                </button>
              );
            }}
          />
        )}

        {level === 'photos' && (isDropboxLoading ? (
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Cloud className="mr-2 h-4 w-4 animate-pulse" />
              Loading photos from Dropbox...
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => onSelect(null)}
                className={`flex aspect-[2/1] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground ${
                  currentCoverPhotoId === null ? 'ring-2 ring-ring' : ''
                }`}
              >
                Use first photo automatically
              </button>
              {activePhotos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => onSelect(photo)}
                  className={`group relative block w-full overflow-hidden rounded-md bg-secondary focus:outline-none focus:ring-2 focus:ring-ring ${
                    currentCoverPhotoId === photo.id ? 'ring-2 ring-ring' : ''
                  }`}
                >
                  <div className="aspect-[2/1]">
                    <StereoThumbnail photo={photo} />
                  </div>
                  <span className="absolute inset-x-0 bottom-0 bg-background/80 px-2 py-1 text-left text-xs backdrop-blur-sm transition-colors group-hover:bg-background/90 group-focus:bg-background/90">
                    {photo.alt || 'Untitled photo'}
                  </span>
                </button>
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}