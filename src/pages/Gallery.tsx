import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { fetchGalleryData, GalleryData, GalleryPhoto } from '@/services/galleryService';
import StereoViewer from '@/components/StereoViewer';
import GifViewer from '@/components/GifViewer';
import TwoDViewer from '@/components/TwoDViewer';
import StereoThumbnail from '@/components/StereoThumbnail';
import { AlertCircle, FolderOpen, Images, LogOut, Settings, Shield, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

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

  const activePhotos = useMemo(
    () => galleryData.photos.filter((photo) => photo.albumId === selectedAlbumId),
    [galleryData.photos, selectedAlbumId],
  );

  const photoCountsByAlbum = useMemo(() => {
    return galleryData.photos.reduce<Record<string, number>>((counts, photo) => {
      if (!photo.albumId) return counts;

      counts[photo.albumId] = (counts[photo.albumId] ?? 0) + 1;
      return counts;
    }, {});
  }, [galleryData.photos]);

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

  const selectedAlbum = useMemo(
    () => galleryData.albums.find((album) => album.id === selectedAlbumId) ?? null,
    [galleryData.albums, selectedAlbumId],
  );

  const selectedEvent = useMemo(
    () => galleryData.events.find((event) => event.id === selectedAlbum?.event_id) ?? null,
    [galleryData.events, selectedAlbum?.event_id],
  );

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
        setSelectedEventId(data.events[0]?.id ?? '');
        setSelectedAlbumId(data.albums[0]?.id ?? '');
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
    const nextAlbum = galleryData.albums.find((album) => album.event_id === eventId);

    setSelectedEventId(eventId);
    setSelectedAlbumId(nextAlbum?.id ?? '');
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
  const selectedAlbumCover = selectedAlbum
    ? getCoverPhoto(photosByAlbum[selectedAlbum.id] ?? [], selectedAlbum.cover_photo_id)
    : null;

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

      <main className="flex flex-col px-4 pb-8 lg:h-[calc(100vh-5rem)] lg:overflow-hidden lg:pb-4">
        {loadError && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Could not load gallery data: {loadError}</span>
          </div>
        )}

        {isGalleryLoading && (
          <div className="mb-4 text-sm text-muted-foreground">Loading gallery from Supabase...</div>
        )}

        <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
          <aside className="space-y-3 rounded-md border border-border bg-card p-3 lg:h-full lg:min-h-0 lg:overflow-auto">
            <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
              <FolderOpen className="h-4 w-4" />
              View
            </div>

            {galleryData.events.length > 0 ? galleryData.events.map((event) => {
              const eventAlbums = galleryData.albums.filter((album) => album.event_id === event.id);
              const eventCover = getCoverPhoto(photosByEvent[event.id] ?? [], event.cover_photo_id);

              return (
                <section key={event.id} className="space-y-2 rounded-md bg-background/60 p-2">
                  <button
                    onClick={() => handleSelectEvent(event.id)}
                    className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors ${
                      selectedEventId === event.id
                        ? 'bg-primary text-primary-foreground'
                        : 'text-foreground hover:bg-accent'
                    }`}
                  >
                    <span className="h-12 w-16 shrink-0 overflow-hidden rounded bg-secondary">
                      {eventCover ? (
                        <StereoThumbnail photo={eventCover} />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center">
                          <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        </span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{event.title}</span>
                      <span
                        className={`block text-xs ${
                          selectedEventId === event.id ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        }`}
                      >
                        {albumCountsByEvent[event.id] ?? 0} albums
                      </span>
                    </span>
                  </button>

                  {eventAlbums.length > 0 ? (
                    <div className="space-y-2">
                      {eventAlbums.map((album) => {
                        const isSelectedAlbum = selectedAlbumId === album.id;
                        const albumCover = getCoverPhoto(photosByAlbum[album.id] ?? [], album.cover_photo_id);

                        return (
                          <div key={album.id} className="rounded-md border border-border/70 bg-secondary/40 p-2">
                            <button
                              onClick={() => handleSelectAlbum(album.id)}
                              className={`flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors ${
                                isSelectedAlbum
                                  ? 'bg-primary text-primary-foreground'
                                  : 'text-foreground hover:bg-accent'
                              }`}
                            >
                              <span className="h-10 w-14 shrink-0 overflow-hidden rounded bg-background">
                                {albumCover ? (
                                  <StereoThumbnail photo={albumCover} />
                                ) : (
                                  <span className="flex h-full w-full items-center justify-center">
                                    <Images className="h-4 w-4 text-muted-foreground" />
                                  </span>
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">{album.title}</span>
                                <span
                                  className={`block text-xs ${
                                    isSelectedAlbum ? 'text-primary-foreground/70' : 'text-muted-foreground'
                                  }`}
                                >
                                  {photoCountsByAlbum[album.id] ?? 0} photos
                                </span>
                              </span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="px-3 py-2 text-sm text-muted-foreground">No albums yet.</p>
                  )}
                </section>
              );
            }) : (
              <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                No events yet.
              </div>
            )}
          </aside>

          <section className="min-w-0 space-y-3 lg:h-full lg:min-h-0 lg:overflow-auto lg:pr-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-16 w-24 shrink-0 overflow-hidden rounded-md bg-secondary">
                  {selectedAlbumCover ? (
                    <StereoThumbnail photo={selectedAlbumCover} />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Images className="h-5 w-5 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-light">
                    {selectedAlbum?.title ?? 'Photos'}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {activePhotos.length} {activePhotos.length === 1 ? 'photo' : 'photos'}
                  </p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button asChild variant="secondary" className="gap-2">
                  <Link to="/manage">
                    <FolderOpen className="h-4 w-4" />
                    Manage Events
                  </Link>
                </Button>
                <Button asChild variant="secondary" className="gap-2">
                  <Link to="/photographers">
                    <User className="h-4 w-4" />
                    Other Photographers
                  </Link>
                </Button>
              </div>
            </div>

            {activePhotos.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {activePhotos.map((photo, index) => (
                  <button
                    key={photo.id}
                    onClick={() => handlePhotoClick(index)}
                    className="group relative aspect-[2/1] overflow-hidden rounded-lg bg-secondary transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                  >
                  <StereoThumbnail photo={photo} />
                </button>
              ))}
              </div>
            ) : (
              <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
                {selectedAlbum ? 'This album does not have photos yet.' : 'Create an event and album to start uploading photos.'}
              </div>
            )}
          </section>
        </div>
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
