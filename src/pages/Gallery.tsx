import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  DropboxFile,
  fetchDropboxPhoto,
  fetchDropboxPhotos,
  fetchGalleryData,
  GalleryData,
  GalleryPhoto,
} from '@/services/galleryService';
import StereoViewer from '@/components/StereoViewer';
import GifViewer from '@/components/GifViewer';
import ThumbnailGrid from '@/components/ThumbnailGrid';
import TwoDViewer from '@/components/TwoDViewer';
import StereoThumbnail from '@/components/StereoThumbnail';
import { AlertCircle, Cloud, FolderOpen, Images, LogOut, Settings, Shield, User } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { AlbumRecord } from '@/types/database';
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
  const [photoSortKey, setPhotoSortKey] = useState<'alt'>('alt');
  const [photoSortDirection, setPhotoSortDirection] = useState<'asc' | 'desc'>('asc');
  const [dropboxCoverUrls, setDropboxCoverUrls] = useState<Record<string, { src: string; name: string }>>({});
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

  useEffect(() => {
    if (!activeAlbums || activeAlbums.length === 0) return;

    const fetchCovers = async () => {
      const coversToFetch = activeAlbums.filter(
        (album) =>
          album.source_type === 'dropbox' &&
          album.dropbox_cover_image_name &&
          album.dropbox_folder_url &&
          !dropboxCoverUrls[album.id]
      );

      if (coversToFetch.length === 0) return;

      const results = await Promise.allSettled(
        coversToFetch.map(async (album) => {
          const photo = await fetchDropboxPhoto(album.dropbox_folder_url!, album.dropbox_cover_image_name!);
          return { albumId: album.id, src: photo.src, name: photo.name };
        })
      );

      const newCoverUrls: Record<string, { src: string; name: string }> = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.src) {
          newCoverUrls[result.value.albumId] = { src: result.value.src, name: result.value.name };
        }
      });

      if (Object.keys(newCoverUrls).length > 0) {
        setDropboxCoverUrls((prev) => ({ ...prev, ...newCoverUrls }));
      }
    };

    fetchCovers();
  }, [activeAlbums, dropboxCoverUrls]);

  useEffect(() => {
    if (!galleryData.events || galleryData.events.length === 0) return;

    const fetchEventCovers = async () => {
      const coversToFetch = galleryData.events.filter(
        (event) => !event.cover_photo_id && !dropboxCoverUrls[`event:${event.id}`],
      );

      if (coversToFetch.length === 0) return;

      const results = await Promise.allSettled(
        coversToFetch.map(async (event) => {
          const dropboxAlbum = galleryData.albums.find(
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

      const newCoverUrls: Record<string, { src: string; name: string }> = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value?.src) {
          newCoverUrls[`event:${result.value.eventId}`] = { src: result.value.src, name: result.value.name };
        }
      });

      if (Object.keys(newCoverUrls).length > 0) {
        setDropboxCoverUrls((prev) => ({ ...prev, ...newCoverUrls }));
      }
    };

    fetchEventCovers();
  }, [galleryData.events, galleryData.albums, dropboxCoverUrls]);

  // Fetch specific dropbox covers for all events in the list
  useEffect(() => {
    if (!galleryData.events.length) return;

    const coversToFetch = galleryData.events.filter(
      (event) =>
        event.dropbox_cover_album_id &&
        event.dropbox_cover_image_name &&
        !dropboxCoverUrls[`event-cover:${event.dropbox_cover_album_id}:${event.dropbox_cover_image_name}`]
    );

    if (coversToFetch.length === 0) return;

    const fetchCovers = async () => {
      const results = await Promise.allSettled(
        coversToFetch.map(async (event) => {
          const album = galleryData.albums.find((a) => a.id === event.dropbox_cover_album_id);
          if (!album || !album.dropbox_folder_url) return null;
          const photo = await fetchDropboxPhoto(album.dropbox_folder_url, event.dropbox_cover_image_name!);
          return { key: `event-cover:${event.dropbox_cover_album_id}:${event.dropbox_cover_image_name}`, src: photo.src, name: photo.name };
        })
      );

      const newCoverUrls: Record<string, { src: string; name: string }> = {};
      results.forEach((result) => { if (result.status === 'fulfilled' && result.value) { newCoverUrls[result.value.key] = { src: result.value.src, name: result.value.name }; } });
      if (Object.keys(newCoverUrls).length > 0) {
        setDropboxCoverUrls((prev) => ({ ...prev, ...newCoverUrls }));
      }
    };

    fetchCovers();
  }, [galleryData.events, galleryData.albums, dropboxCoverUrls]);

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
    return dropboxPhotos.map((file: any) => {
      // DEBUG: Log the incoming file object to see if 'src' exists here
      console.log("Mapping file:", file);
      
      return {
        id: file.id,
        // Ensure we explicitly grab 'src' from the file object
        // If file.src is undefined here, your Edge Function isn't returning it
        src: file.src || '', 
        alt: file.name,
        albumId: selectedAlbumId,
        eventId: selectedEventId,
      };
    });
  }
  return galleryData.photos.filter((photo) => photo.albumId === selectedAlbumId);
}, [isDropboxAlbum, dropboxPhotos, galleryData.photos, selectedAlbumId, selectedEventId]);

  const sortedActivePhotos = useMemo(() => {
    return [...activePhotos].sort((a, b) => {
      const comparison = (a.alt || '').localeCompare(b.alt || '', undefined, { numeric: true });
      return photoSortDirection === 'asc' ? comparison : -comparison;
    });
  }, [activePhotos, photoSortKey, photoSortDirection]);

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
            
            {/* View Mode Toggle */}
          <div className="flex rounded-lg bg-secondary p-1">
            <button
              onClick={() => setViewMode('stereo')}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                viewMode === 'stereo'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Stereo
            </button>
            <button
              onClick={() => setViewMode('2d')}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                viewMode === '2d'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              2D
            </button>
            <button
              onClick={() => setViewMode('gif')}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                viewMode === 'gif'
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              GIF
            </button>
          </div>
          </div>
        </div>

        {galleryLevel === 'photos' && activePhotos.length > 1 && (
          <div className="mb-4 flex items-center justify-start gap-2">
            <span className="text-xs font-medium text-muted-foreground">Sort by</span>
            <Select value={photoSortKey} onValueChange={(v) => setPhotoSortKey(v as 'alt')}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alt">Name</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => setPhotoSortDirection(d => d === 'asc' ? 'desc' : 'asc')}>
              {photoSortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />}
            </Button>
          </div>
        )}

        {galleryLevel === 'events' && (
          <ThumbnailGrid
            items={galleryData.events}
            sortOptions={[
              { value: 'title', label: 'Name' },
            { value: 'created_at', label: 'Creation Date' },
            ]}
            emptyMessage="No events yet."
            renderItem={(event) => {
              const eventPhotos = photosByEvent[event.id] ?? [];
              let eventCover: GalleryPhoto | null = null;

              // 1. Check for explicitly set Dropbox cover
              if (event.dropbox_cover_album_id && event.dropbox_cover_image_name) {
                const coverKey = `event-cover:${event.dropbox_cover_album_id}:${event.dropbox_cover_image_name}`;
                const coverInfo = dropboxCoverUrls[coverKey];
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

              // 3. If still no cover, check for a default fetched Dropbox cover (first photo of first dropbox album)
              if (!eventCover) {
                const coverInfo = dropboxCoverUrls[`event:${event.id}`];
                if (coverInfo) {
                  eventCover = { id: `event-cover-${event.id}`, src: coverInfo.src, alt: coverInfo.name, eventId: event.id };
                }
              }

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
            sortOptions={[
              { value: 'title', label: 'Name' },
            { value: 'created_at', label: 'Creation Date' },
            ]}
            emptyMessage="This event does not have albums yet."
            renderItem={(album) => {
              const photos = photosByAlbum[album.id] ?? [];
              let albumCover: GalleryPhoto | null = null;

              if (album.source_type === 'dropbox' && album.dropbox_cover_image_name) {
                const coverInfo = dropboxCoverUrls[album.id];
                if (coverInfo) {
                  albumCover = {
                    id: `${album.id}-${album.dropbox_cover_image_name}`,
                    src: coverInfo.src,
                    alt: coverInfo.name,
                    albumId: album.id,
                    eventId: album.event_id,
                  };
                }
              } else {
                albumCover = getCoverPhoto(photos, album.cover_photo_id);
              }

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
        {isViewerOpen && viewMode === 'stereo' && (
          <StereoViewer
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
        {isViewerOpen && viewMode === '2d' && (
          <TwoDViewer
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
        {isViewerOpen && viewMode === 'gif' && (
          <GifViewer
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
