import { useMemo, useState, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchDropboxPhotos, GalleryData, GalleryPhoto, getFileExtension } from '@/services/galleryService';
import type { AlbumRecord, EventRecord } from '@/types/database';
import StereoThumbnail from '@/components/StereoThumbnail';
import { ProfileCoverPhotoPicker } from '@/components/ProfileCoverPhotoPicker';
import { usePhotoSort } from '@/hooks/usePhotoSort';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function ObjectCoverPickerDialog({
  open,
  onClose,
  object,
  galleryData,
  onSelect,
  currentCoverPhotoId,
  currentDropboxCoverName,
  dropboxCoverUrls,
}: {
  open: boolean;
  onClose: () => void;
  object: 'profile' | EventRecord | AlbumRecord;
  galleryData: GalleryData;
  onSelect: (photo: (GalleryPhoto & { isDropbox?: boolean; album: AlbumRecord | null }) | null) => void;
  currentCoverPhotoId: string | null;
  currentDropboxCoverName?: string | null;
  dropboxCoverUrls?: Record<string, { src: string; name: string }>;
}) {
  const [photos, setPhotos] = useState<(GalleryPhoto & { isDropbox?: boolean; album: AlbumRecord | null })[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coverSort, setCoverSort] = useState('alt_asc');

  const title = useMemo(() => {
    if (object === 'profile') {
      return 'Choose Photographer Cover';
    }
    if ('owner_id' in object) {
      // EventRecord
      return 'Choose Event Cover';
    }
    // AlbumRecord
    return 'Choose Album Cover';
  }, [object]);

  useEffect(() => {
    if (!open) return;

    if (object === 'profile') {
      setIsLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const fetchPhotos = async () => {
      setIsLoading(true);
      setError(null);
      try {
        let fetchedPhotos: (GalleryPhoto & { isDropbox?: boolean; album: AlbumRecord | null })[] = [];
        if ('owner_id' in object) {
          // Event
          // Event covers can only be uploaded photos from within that event.
          const event = object;
          const uploadedPhotos = galleryData.photos
            .filter((p) => p.eventId === event.id)
            .map((p) => ({ ...p, isDropbox: false, album: galleryData.albums.find((a) => a.id === p.albumId) ?? null }));

          const dropboxAlbums = galleryData.albums.filter(
            (a) => a.event_id === event.id && a.source_type === 'dropbox' && a.dropbox_folder_url,
          );

          const dropboxPhotosNested = await Promise.all(
            dropboxAlbums.map((album) =>
              fetchDropboxPhotos(album.dropbox_folder_url!).then((files) =>
                files.map((file) => ({
                  id: file.id,
                  src: file.src,
                  alt: file.name,
                  isDropbox: true,
                  albumId: album.id,
                  eventId: album.event_id,
                  album,
                  created_at: file.client_modified,
                  extension: getFileExtension(file.name),
                })),
              ),
            ),
          );
          const dropboxPhotos = dropboxPhotosNested.flat();

          fetchedPhotos = [...uploadedPhotos, ...dropboxPhotos];
        } else {
          // Album
          // Album covers can be uploaded photos or from a linked Dropbox folder.
          const album = object;
          if (album.source_type === 'dropbox' && album.dropbox_folder_url) {
            const files = await fetchDropboxPhotos(album.dropbox_folder_url);
            fetchedPhotos = files.map((file) => ({
              id: file.id,
              src: file.src,
              alt: file.name,
              isDropbox: true,
              albumId: album.id,
              eventId: album.event_id,
              album: album,
              created_at: file.client_modified,
              extension: getFileExtension(file.name),
            }));
          } else {
            fetchedPhotos = (galleryData.photos.filter((p) => p.albumId === album.id) ?? []).map((p) => ({
              ...p,
              isDropbox: false,
              album: album,
            }));
          }
        }
        if (!cancelled) {
          setPhotos(fetchedPhotos);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load photos.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    fetchPhotos();
    return () => {
      cancelled = true;
    };
  }, [open, object, galleryData]);

  const selectedId = currentDropboxCoverName
    ? photos.find((p) => p.isDropbox && p.alt === currentDropboxCoverName)?.id ?? null
    : currentCoverPhotoId;

  const sortedPhotos = usePhotoSort(photos as GalleryPhoto[], coverSort);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="flex max-h-[90vh] w-[90vw] max-w-4xl flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Choose a photo visually. If no cover is selected, the first photo is used.</DialogDescription>
        </DialogHeader>
        {isLoading && (
          <div className="flex items-center justify-center p-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}
        {error && <p className="text-destructive p-8 text-center">{error}</p>}
        {!isLoading && !error && (
          object === 'profile' ? (
            <ProfileCoverPhotoPicker
              galleryData={galleryData}
              onSelect={onSelect}
              currentCoverPhotoId={currentCoverPhotoId}
              dropboxCoverUrls={dropboxCoverUrls}
            />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
              <div className="flex items-center justify-start gap-2">
                <span className="text-xs font-medium text-muted-foreground">Sort by</span>
                <Select value={coverSort} onValueChange={setCoverSort}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alt_asc">Name A-Z</SelectItem>
                    <SelectItem value="alt_desc">Name Z-A</SelectItem>
                    <SelectItem value="created_at_desc">Date New-Old</SelectItem>
                    <SelectItem value="created_at_asc">Date Old-New</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div
                className="grid min-h-0 flex-1
                grid-cols-1
                sm:grid-cols-2
                lg:grid-cols-3
                gap-3
                overflow-y-auto
                content-start
                auto-rows-max
                p-1"
              >
                <button
                  type="button"
                  onClick={() => onSelect(null)}
                  className={`flex aspect-[2/1] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground ${
                    selectedId === null ? 'ring-2 ring-ring' : ''
                  }`}
                >
                  Use first photo automatically
                </button>
                {sortedPhotos.map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => onSelect(photo)}
                  className={`group relative block w-full overflow-hidden rounded-md bg-secondary focus:outline-none focus:ring-2 focus:ring-ring ${
                    selectedId === photo.id ? 'ring-2 ring-ring' : ''
                  }`}
                >
                  <div className="aspect-[2/1]">
                    <StereoThumbnail photo={photo} album={photo.album} />
                  </div>
                  <span className="absolute inset-x-0 bottom-0 bg-background/80 px-2 py-1 text-left text-xs backdrop-blur-sm transition-colors group-hover:bg-background/90 group-focus:bg-background/90">
                    {photo.alt || 'Untitled photo'}
                  </span>
                </button>
              ))}
              </div>
            </div>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}