import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchDropboxPhotos,
  fetchGalleryData,
  GalleryData,
  GalleryPhoto,
} from '@/services/galleryService';
import StereoViewer from '@/components/StereoViewer';
import GifViewer from '@/components/GifViewer';
import TwoDViewer from '@/components/TwoDViewer';
import StereoThumbnail from '@/components/StereoThumbnail';
import { AlertCircle, Cloud, FolderOpen, Images, LogOut, Settings, Shield, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';

type ViewMode = 'stereo' | '2d' | 'gif';

type WebKitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type WebKitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function getCoverPhoto(photos: GalleryPhoto[], coverPhotoId?: string | null) {
  return photos.find((photo) => photo.id === coverPhotoId) ?? photos[0] ?? null;
}

export default function Gallery() {
  const { isAuthenticated, isAdmin, isLoading: isAuthLoading, logout, profile } = useAuth();
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('stereo');
  const [galleryData, setGalleryData] = useState<GalleryData>({ events: [], albums: [], photos: [] });
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedAlbumId, setSelectedAlbumId] = useState('');
  const [isGalleryLoading, setIsGalleryLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
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

  const [dropboxPhotos, setDropboxPhotos] = useState<GalleryPhoto[]>([]);
  const [isDropboxLoading, setIsDropboxLoading] = useState(false);

  const selectedAlbum = useMemo(
    () => galleryData.albums.find((album) => album.id === selectedAlbumId) ?? null,
    [galleryData.albums, selectedAlbumId],
  );

  const isDropboxAlbum = selectedAlbum?.source_type === 'dropbox';

  useEffect(() => {
    if (!isDropboxAlbum || !selectedAlbum.dropbox_folder_url) {
      setDropboxPhotos([]);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setIsDropboxLoading(true);
      try {
        const files = await fetchDropboxPhotos(selectedAlbum!.dropbox_folder_url!);
        if (cancelled) return;

        // Each image file from Dropbox is an SBS photo.
        // We create temporary `GalleryPhoto` objects for display.
        const tempPhotos: GalleryPhoto[] = files.map((file) => ({
          id: file.path, // Use the unique path as an ID
          src: file.url,
          alt: file.name.replace(/\.(jpg|jpeg|png|webp)$/i, ''),
          // No rightSrc is needed, as `src` is the full SBS image
        }));

        setDropboxPhotos(tempPhotos);
      } catch (error) {
        toast({
          title: 'Could not load Dropbox photos',
          description: error instanceof Error ? error.message : 'An unknown error occurred.',
          variant: 'destructive',
        });
        setDropboxPhotos([]);
      } finally {
        if (!cancelled) setIsDropboxLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [isDropboxAlbum, selectedAlbum]);

  const activePhotos = useMemo(
    () => (isDropboxAlbum ? dropboxPhotos : galleryData.photos.filter((photo) => photo.albumId === selectedAlbumId)),
    [galleryData.photos, selectedAlbumId, isDropboxAlbum, dropboxPhotos],
  );

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
    try {
      const fullscreenDocument = document as WebKitFullscreenDocument;
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (fullscreenDocument.webkitFullscreenElement) {
        await fullscreenDocument.webkitExitFullscreen?.();
      }
    } catch (e) {
      // Ignore errors
    }
    setSelectedPhotoIndex(null);
  }, []);

  // Listen for fullscreen exit (user presses back/escape)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fullscreenDocument = document as WebKitFullscreenDocument;
      const isFullscreen = !!(document.fullscreenElement || fullscreenDocument.webkitFullscreenElement);
      if (!isFullscreen && selectedPhotoIndex !== null) {
        setSelectedPhotoIndex(null);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [selectedPhotoIndex]);

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
    const container = fullscreenContainerRef.current;
    if (container) {
      const fullscreenContainer = container as WebKitFullscreenElement;
      // Request fullscreen immediately - this is synchronous with user gesture
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      } else if (fullscreenContainer.webkitRequestFullscreen) {
        fullscreenContainer.webkitRequestFullscreen();
      }
    }
    setSelectedPhotoIndex(index);
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (selectedPhotoIndex === null) return;

    if (direction === 'prev' && selectedPhotoIndex > 0) {
      setSelectedPhotoIndex(selectedPhotoIndex - 1);
    } else if (direction === 'next' && selectedPhotoIndex < activePhotos.length - 1) {
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
      <header className="sticky top-0 z-10 flex items-center justify-between bg-background/80 px-4 py-4 backdrop-blur-sm">
        <h1 className="text-xl font-light tracking-wide">Greg's Photos</h1>
        <div className="flex items-center gap-2">
          {profile?.role && (
            <Badge variant="outline" className="hidden sm:inline-flex">
              {profile.role}
            </Badge>
          )}
          <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Link to="/manage">
              <Settings className="h-5 w-5" />
            </Link>
          </Button>
          <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
            <Link to="/photographers">
              <User className="h-5 w-5" />
            </Link>
          </Button>
          {isAdmin && (
            <Button asChild variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
              <Link to="/admin">
                <Shield className="h-5 w-5" />
              </Link>
            </Button>
          )}
          {/* View Mode Toggle */}
          <div className="flex rounded-lg bg-secondary p-1">
            <button
              onClick={() => setViewMode('stereo')}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                viewMode === 'stereo'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Stereo
            </button>
            <button
              onClick={() => setViewMode('2d')}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                viewMode === '2d'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              2D
            </button>
            <button
              onClick={() => setViewMode('gif')}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                viewMode === 'gif'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              GIF
            </button>
          </div>
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
            <p className="text-sm text-muted-foreground">{gallerySubtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="secondary" className="gap-2">
              <Link to="/manage">
                <FolderOpen className="h-4 w-4" />
                Manage
              </Link>
            </Button>
            <Button asChild variant="secondary" className="gap-2">
              <Link to="/photographers">
                <User className="h-4 w-4" />
                Photographers
              </Link>
            </Button>
          </div>
        </div>

        {galleryLevel === 'events' && (
          galleryData.events.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {galleryData.events.map((event) => {
                const eventCover = getCoverPhoto(photosByEvent[event.id] ?? [], event.cover_photo_id);

                return (
                  <button
                    key={event.id}
                    onClick={() => handleSelectEvent(event.id)}
                    className="group overflow-hidden rounded-md border border-border bg-card text-left transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <span className="block aspect-[3/2] bg-secondary">
                      {eventCover ? (
                        <StereoThumbnail photo={eventCover} />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <FolderOpen className="h-6 w-6 text-muted-foreground" />
                        </span>
                      )}
                    </span>
                    <span className="block min-w-0 p-2">
                      <span className="block truncate text-sm font-medium">{event.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {albumCountsByEvent[event.id] ?? 0} albums
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
              No events yet.
            </div>
          )
        )}

        {galleryLevel === 'albums' && selectedEvent && (
          activeAlbums.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {activeAlbums.map((album) => {
                const albumCover = getCoverPhoto(photosByAlbum[album.id] ?? [], album.cover_photo_id);

                return (
                  <button
                    key={album.id}
                    onClick={() => handleSelectAlbum(album.id)}
                    className="group overflow-hidden rounded-md border border-border bg-card text-left transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <span className="block aspect-[3/2] bg-secondary">
                      {albumCover ? (
                        <StereoThumbnail photo={albumCover} />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <Images className="h-6 w-6 text-muted-foreground" />
                        </span>
                      )}
                    </span>
                    <span className="block min-w-0 p-2">
                      <span className="block truncate text-sm font-medium">{album.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {album.source_type === 'dropbox' ? (
                          <span className="flex items-center gap-1.5">
                            <Cloud className="h-3 w-3" />
                            {photoCountsByAlbum[album.id] === -1 ? '? photos' : `${photoCountsByAlbum[album.id]} photos`}
                          </span>
                        ) : (
                          `${photoCountsByAlbum[album.id] ?? 0} photos`
                        )}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground">
              This event does not have albums yet.
            </div>
          )
        )}

        {galleryLevel === 'photos' && (isDropboxLoading ? (
            <div className="flex items-center justify-center rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              <Cloud className="mr-2 h-4 w-4 animate-pulse" />
              Loading photos from Dropbox...
            </div>
          ) : activePhotos.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {activePhotos.map((photo, index) => (
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
        {isViewerOpen && viewMode === 'stereo' && (
          <StereoViewer
            photo={activePhotos[selectedPhotoIndex]}
            photos={activePhotos}
            photoIndex={selectedPhotoIndex}
            onClose={handleCloseViewer}
            onPrevious={() => handleNavigate('prev')}
            onNext={() => handleNavigate('next')}
            hasPrevious={selectedPhotoIndex > 0}
            hasNext={selectedPhotoIndex < activePhotos.length - 1}
          />
        )}
        {isViewerOpen && viewMode === '2d' && (
          <TwoDViewer
            photo={activePhotos[selectedPhotoIndex]}
            photos={activePhotos}
            photoIndex={selectedPhotoIndex}
            onClose={handleCloseViewer}
            onPrevious={() => handleNavigate('prev')}
            onNext={() => handleNavigate('next')}
            hasPrevious={selectedPhotoIndex > 0}
            hasNext={selectedPhotoIndex < activePhotos.length - 1}
          />
        )}
        {isViewerOpen && viewMode === 'gif' && (
          <GifViewer
            photo={activePhotos[selectedPhotoIndex]}
            photos={activePhotos}
            photoIndex={selectedPhotoIndex}
            onClose={handleCloseViewer}
            onPrevious={() => handleNavigate('prev')}
            onNext={() => handleNavigate('next')}
            hasPrevious={selectedPhotoIndex > 0}
            hasNext={selectedPhotoIndex < activePhotos.length - 1}
          />
        )}
      </div>
    </div>
  );
}
