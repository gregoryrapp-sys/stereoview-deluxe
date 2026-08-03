import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  DropboxFile,
  fetchDropboxPhotos,
  fetchGalleryData,
  GalleryData,
  GalleryPhoto,
} from '@/services/galleryService';
import SmartViewer from '@/components/SmartViewer';
import ThumbnailGrid from '@/components/ThumbnailGrid';
import StereoThumbnail from '@/components/StereoThumbnail';
import { AlertCircle, Cloud, FolderOpen, Images, LogOut, Settings, Shield, User } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AlbumRecord } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { COLLECTION_SORT_OPTIONS, resolveAlbumCover, resolveEventCover } from '@/lib/galleryUtils';
import { exitPhotoFullscreen, requestPhotoFullscreen } from '@/lib/fullscreen';
import { usePhotoSort } from '@/hooks/usePhotoSort';
import { useDropboxCovers } from '@/hooks/useDropboxCovers';



export default function Gallery() {
  const { isAuthenticated, isAdmin, isLoading: isAuthLoading, logout, profile } = useAuth();
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [galleryData, setGalleryData] = useState<GalleryData>({ events: [], albums: [], photos: [] });
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedAlbumId, setSelectedAlbumId] = useState('');
  const [isGalleryLoading, setIsGalleryLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [photoSort, setPhotoSort] = useState('alt_asc');
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);

  const albumCountsByEvent = useMemo(() => {
    return galleryData.albums.reduce<Record<string, number>>((counts, album) => {
      counts[album.event_id] = (counts[album.event_id] ?? 0) + 1;
      return counts;
    }, {});
  }, [galleryData.albums]);

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

  const activeAlbums = useMemo(
    () => galleryData.albums.filter((album) => album.event_id === selectedEventId),
    [galleryData.albums, selectedEventId],
  );

  const manageLink = useMemo(() => {
    if (selectedAlbumId && selectedEventId) {
      return `/manage/events/${selectedEventId}/albums/${selectedAlbumId}`;
    }
    if (selectedEventId) {
      return `/manage/events/${selectedEventId}`;
    }
    return '/manage';
  }, [selectedEventId, selectedAlbumId]);

  const { dropboxCoverUrls } = useDropboxCovers(galleryData.events, galleryData.albums, activeAlbums);

  const [dropboxPhotos, setDropboxPhotos] = useState<DropboxFile[]>([]);
  const [isDropboxLoading, setIsDropboxLoading] = useState(false);

  const selectedAlbum = useMemo(
    () => galleryData.albums.find((album) => album.id === selectedAlbumId) ?? null,
    [galleryData.albums, selectedAlbumId],
  );

  const isDropboxAlbum = selectedAlbum?.source_type === 'dropbox';

  useEffect(() => {
  if (!selectedAlbum?.dropbox_folder_url) {
    setDropboxPhotos([]);
    return;
  }

  let cancelled = false;

  const run = async () => {
    setIsDropboxLoading(true);

    try {
      const files = await fetchDropboxPhotos(selectedAlbum.dropbox_folder_url);

      if (cancelled) return;

      setDropboxPhotos(files);
    } catch (error) {
      toast({
        title: 'Could not load Dropbox photos',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });

      setDropboxPhotos([]);
    } finally {
      if (!cancelled) setIsDropboxLoading(false);
    }
  };

  run();

  return () => {
    cancelled = true;
  };
}, [isDropboxAlbum, selectedAlbum?.dropbox_folder_url]);

  const activePhotos = useMemo(() => {
  if (isDropboxAlbum) {
    return dropboxPhotos.map((file: any) => ({
        id: file.id,
        src: file.src || '',
        alt: file.name,
        albumId: selectedAlbumId,
        eventId: selectedEventId,
        created_at: file.client_modified,
      }));
  }
  return galleryData.photos.filter((photo) => photo.albumId === selectedAlbumId);
}, [isDropboxAlbum, dropboxPhotos, galleryData.photos, selectedAlbumId, selectedEventId]);

  const sortedActivePhotos = usePhotoSort(activePhotos, photoSort);

  const photoCountsByAlbum = useMemo(() => {
    const counts = galleryData.photos.reduce<Record<string, number>>((counts, photo) => {
      if (!photo.albumId) return counts;

      counts[photo.albumId] = (counts[photo.albumId] ?? 0) + 1;
      return counts;
    }, {});

    // For dropbox albums, we don't know the count until it's loaded.
    galleryData.albums.forEach((album) => {
      if (album.source_type === 'dropbox') {
        if (selectedAlbumId === album.id) {
          // If this album is selected, show the count from the loaded dropboxPhotos
          counts[album.id] = dropboxPhotos.length;
        } else if (!counts[album.id]) {
          // Use -1 as a sentinel for "unknown count" for non-selected dropbox albums
          counts[album.id] = -1;
        }
      }
    });

    return counts;
  }, [galleryData.photos, galleryData.albums, selectedAlbumId, dropboxPhotos]);

  const handleCloseViewer = useCallback(async () => {
    // Exit fullscreen first
    await exitPhotoFullscreen();
    setSelectedPhotoIndex(null);
  }, []);

  const loadGallery = useCallback(() => {
    let cancelled = false;

    async function run() {
      setIsGalleryLoading(true);
      setLoadError(null);

      try {
        const data = await fetchGalleryData();

        if (cancelled) return;

        setGalleryData(data);
        setSelectedEventId('');
        setSelectedAlbumId('');
      } catch (error) {
        if (cancelled) return;

        setGalleryData({ events: [], albums: [], photos: [] });
        setSelectedEventId('');
        setSelectedAlbumId('');
        setLoadError(error instanceof Error ? error.message : 'Could not load Supabase gallery');
      } finally {
        if (!cancelled) {
          setIsGalleryLoading(false);
        }
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    return loadGallery();
  }, [isAuthenticated, loadGallery]);

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  // Request fullscreen synchronously in click handler (user gesture required)
  const handlePhotoClick = (index: number) => {
    // Request fullscreen immediately - this is synchronous with user gesture
    requestPhotoFullscreen(fullscreenContainerRef.current);
    setSelectedPhotoIndex(index);
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (selectedPhotoIndex === null) return;

    if (direction === 'prev' && selectedPhotoIndex > 0) {
      setSelectedPhotoIndex(selectedPhotoIndex - 1);
    } else if (direction === 'next' && selectedPhotoIndex < sortedActivePhotos.length - 1) {
      setSelectedPhotoIndex(selectedPhotoIndex + 1);
    }
  };

  const handleSelectEvent = (eventId: string) => {
    setSelectedEventId(eventId);
    setSelectedAlbumId('');
    setSelectedPhotoIndex(null);
  };

  const handleSelectAlbum = (albumId: string) => {
    const album = galleryData.albums.find((albumRecord) => albumRecord.id === albumId);

    if (album) {
      setSelectedEventId(album.event_id);
    }

    setSelectedAlbumId(albumId);
    setSelectedPhotoIndex(null);
  };

  const isViewerOpen = selectedPhotoIndex !== null;
  const galleryLevel = selectedAlbum ? 'photos' : selectedEvent ? 'albums' : 'events';
  const galleryTitle = selectedAlbum?.title ?? selectedEvent?.title ?? 'Events';
  const gallerySubtitle =
    galleryLevel === 'events'
      ? `${galleryData.events.length} ${galleryData.events.length === 1 ? 'event' : 'events'}`
      : galleryLevel === 'albums'
        ? `${activeAlbums.length} ${activeAlbums.length === 1 ? 'album' : 'albums'}`
        : `${activePhotos.length} ${activePhotos.length === 1 ? 'photo' : 'photos'}`;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between bg-background/80 px-20 py-4  backdrop-blur-sm">
        <h1 className="text-xl font-light tracking-wide"> {profile ? profile.display_name : ''}'s Photos</h1>
        <div className="flex items-center gap-2 text-md font-medium text-muted-foreground">
          {profile?.role && (
            <Badge variant="outline" className="hidden sm:inline-flex">
              {profile.display_name} {profile.role ? `(${profile.role})` : ''   }
            </Badge>
          )}
          
          <Button asChild  variant="secondary" className=" text:muted-foreground hover:text-foreground ">
            <Link to="/">
              <User className="h-5 w-5" />
              All Photographers Gallery
            </Link>
          </Button>
          {isAdmin && (
            <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <Link to="/admin">
                <Shield className="h-5 w-5" />
              </Link>
            </Button>
          )}
          
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col px-3 pb-8 sm:px-4">
        {loadError && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Could not load gallery data: {loadError}</span>
          </div>
        )}

        {isGalleryLoading && (
          <div className="mb-4 text-sm text-muted-foreground">Loading gallery from Supabase...</div>
        )}

        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {selectedEvent && (
                <button type="button" onClick={() => {
                  setSelectedEventId('');
                  setSelectedAlbumId('');
                }} className="hover:text-foreground">
                  Events
                </button>
              )}
              {selectedEvent && <span>/</span>}
              {selectedEvent && selectedAlbum && (
                <button type="button" onClick={() => setSelectedAlbumId('')} className="hover:text-foreground">
                  {selectedEvent.title}
                </button>
              )}
              {selectedEvent && !selectedAlbum && <span>{selectedEvent.title}</span>}
              {selectedAlbum && <span>/</span>}
              {selectedAlbum && <span>{selectedAlbum.title}</span>}
            </div>
            <h2 className="truncate text-xl font-light">{galleryTitle}</h2>
            <p className="text-sm text-muted-foreground">
              {gallerySubtitle}
              {galleryLevel === 'photos' && isDropboxAlbum && (
                <span className="font-medium text-sky-600 dark:text-sky-400">
                  {' · '} <Cloud className="inline h-3 w-3" /> Dropbox Live
                </span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" size="icon" title="Manage Current View">
              <Link to={manageLink}>
                <Settings className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        {galleryLevel === 'photos' && activePhotos.length > 1 && (
          <div className="mb-4 flex items-center justify-start gap-2">
            <span className="text-xs font-medium text-muted-foreground">Sort by</span>
            <Select value={photoSort} onValueChange={setPhotoSort}>
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
        )}

        {galleryLevel === 'events' && (
          <ThumbnailGrid
            items={galleryData.events}
            sortOptions={COLLECTION_SORT_OPTIONS}
            emptyMessage="No events yet."
            renderItem={(event) => {
              const eventPhotos = photosByEvent[event.id] ?? [];
              const eventCover = resolveEventCover(event, eventPhotos, dropboxCoverUrls);

              return (
                <button
                  key={event.id}
                  onClick={() => handleSelectEvent(event.id)}
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
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{albumCountsByEvent[event.id] ?? 0} albums</span>
                      <span className="font-mono">{new Date(event.created_at).toLocaleDateString()}</span>
                    </div>
                  </span>
                </button>
              );
            }}
          />
        )}

        {galleryLevel === 'albums' && selectedEvent && (
          <ThumbnailGrid
            items={activeAlbums}
            sortOptions={COLLECTION_SORT_OPTIONS}
            emptyMessage="This event does not have albums yet."
            renderItem={(album) => {
              const photos = photosByAlbum[album.id] ?? [];
              const albumCover = resolveAlbumCover(album, photos, dropboxCoverUrls);

              return (
                <button
                  key={album.id}
                  onClick={() => handleSelectAlbum(album.id)}
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
                    <span className="block text-xs text-muted-foreground">
                      {album.source_type === 'dropbox' ? (
                        <span className="flex items-center gap-1.5 font-medium text-sky-600 dark:text-sky-400">
                          <Cloud className="h-3 w-3" />
                          Dropbox Live
                        </span>
                      ) : (
                        `${photoCountsByAlbum[album.id] ?? 0} photos`
                      )}
                    </span>
                  </span>
                </button>
              );
            }}
          />
        )}

        {galleryLevel === 'photos' && (isDropboxLoading ? (
            <div className="flex items-center justify-center rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              <Cloud className="mr-2 h-4 w-4 animate-pulse" />
              Loading photos from Dropbox...
            </div>
          ) : sortedActivePhotos.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {sortedActivePhotos.map((photo, index) => (
                <button
                  key={photo.id}
                  onClick={() => handlePhotoClick(index)}
                  className="group relative aspect-[2/1] overflow-hidden rounded-md bg-secondary transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                >
                <StereoThumbnail photo={photo} />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
              {isDropboxAlbum && <Cloud className="mr-2 h-4 w-4" />}
              {selectedAlbum ? 'This album is empty.' : 'Create an event and album to start uploading photos.'}
            </div>
          )
        )}
      </main>

      {/* Fullscreen Container - always in DOM for immediate fullscreen request */}
      <div
        ref={fullscreenContainerRef}
        className={`fixed inset-0 z-50 bg-black ${isViewerOpen ? 'block' : 'hidden'}`}
      >
        {isViewerOpen && (
          <SmartViewer
            photo={sortedActivePhotos[selectedPhotoIndex]}
            album={selectedAlbum}
            photos={sortedActivePhotos}
            photoIndex={selectedPhotoIndex}
            onClose={handleCloseViewer}
            onPrevious={() => handleNavigate('prev')}
            onNext={() => handleNavigate('next')}
            hasPrevious={selectedPhotoIndex > 0}
            hasNext={selectedPhotoIndex < sortedActivePhotos.length - 1}
          />
        )}
      </div>
    </div>
  );
}
