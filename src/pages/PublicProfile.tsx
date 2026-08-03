import { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Cloud, FolderOpen, Images , User} from 'lucide-react';
import StereoThumbnail from '@/components/StereoThumbnail';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { fetchDropboxFileBlob, fetchDropboxPhoto, fetchPublicProfileBySlug, GalleryPhoto, SharedGalleryData, fetchDropboxPhotos } from '@/services/galleryService';
import ThumbnailGrid from '@/components/ThumbnailGrid';
import SmartViewer from '@/components/SmartViewer';
import { COLLECTION_SORT_OPTIONS, getCoverPhoto } from '@/lib/galleryUtils';
import { exitPhotoFullscreen, requestPhotoFullscreen } from '@/lib/fullscreen';
import { usePhotoSort } from '@/hooks/usePhotoSort';

export default function PublicProfile() {
  const { isAuthenticated } = useAuth();
  const { profileSlug = '', eventSlug = null, albumSlug = null } = useParams();
  const [data, setData] = useState<SharedGalleryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [photoSort, setPhotoSort] = useState('alt_asc');
  const [dropboxAlbumPhotos, setDropboxAlbumPhotos] = useState<GalleryPhoto[]>([]);
  const [isDropboxLoading, setIsDropboxLoading] = useState(false);
  const [dropboxCoverUrls, setDropboxCoverUrls] = useState<Record<string, { src: string; name: string }>>({});
  const [dropboxProfileCover, setDropboxProfileCover] = useState<GalleryPhoto | null>(null);
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function loadPublicData() {
      if (!profileSlug) return;
      setIsLoading(true);
      setError('');
      try {
        const result = await fetchPublicProfileBySlug(profileSlug);
        if (!result) {
          setError('Profile not found or is not public.');
        } else {
          setData(result);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load gallery.');
      } finally {
        setIsLoading(false);
      }
    }
    loadPublicData();
  }, [profileSlug]);

  useEffect(() => {
    if (!data?.profile) return;

    const profile = data.profile as any;
    if (profile.dropbox_cover_album_id && profile.dropbox_cover_image_name) {
      const album = data.albums.find(a => a.id === profile.dropbox_cover_album_id);
      if (album?.dropbox_folder_url) {
        let cancelled = false;
        let objectUrl: string | null = null;
        const fetchCover = async () => {
          try {
            const photo = await fetchDropboxPhoto(album.dropbox_folder_url!, profile.dropbox_cover_image_name);
            const blob = await fetchDropboxFileBlob({
              folderUrl: album.dropbox_folder_url!,
              fileName: photo.name,
            });
            objectUrl = URL.createObjectURL(blob);
            if (!cancelled) {
              setDropboxProfileCover({ id: photo.id, src: objectUrl, alt: photo.name });
            } else if (objectUrl) {
              URL.revokeObjectURL(objectUrl);
            }
          } catch (e) {
            console.error("Failed to fetch dropbox profile cover", e);
          }
        };
        fetchCover();
        return () => {
          cancelled = true;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
      }
    }
  }, [data]);

  useEffect(() => {
    if (!data) return;

    const fetchCovers = async () => {
      const coversToFetch: { id: string; folderUrl: string; imageName: string }[] = [];

      // Event covers
      data.events.forEach(event => {
        const e = event as any;
        if (e.dropbox_cover_album_id && e.dropbox_cover_image_name) {
          const album = data.albums.find(a => a.id === e.dropbox_cover_album_id);
          if (album?.dropbox_folder_url) {
            coversToFetch.push({
              id: `event:${e.id}`,
              folderUrl: album.dropbox_folder_url,
              imageName: e.dropbox_cover_image_name,
            });
          }
        }
      });

      // Album covers
      data.albums.forEach(album => {
        const a = album as any;
        if (a.source_type === 'dropbox' && a.dropbox_cover_image_name && a.dropbox_folder_url) {
          coversToFetch.push({
            id: `album:${a.id}`,
            folderUrl: a.dropbox_folder_url,
            imageName: a.dropbox_cover_image_name,
          });
        }
      });

      if (coversToFetch.length === 0) return;

      const objectUrls: string[] = [];
      const results = await Promise.allSettled(
        coversToFetch.map(async (item) => {
          const photo = await fetchDropboxPhoto(item.folderUrl, item.imageName);
          const blob = await fetchDropboxFileBlob({
            folderUrl: item.folderUrl,
            fileName: photo.name,
          });
          const src = URL.createObjectURL(blob);
          objectUrls.push(src);
          return { id: item.id, src, name: photo.name };
        })
      );

      const newCoverUrls: Record<string, { src: string; name: string }> = {};
      results.forEach((result) => {
        if (result.status === 'fulfilled' && result.value.src) {
          newCoverUrls[result.value.id] = { src: result.value.src, name: result.value.name };
        }
      });

      if (!cancelled && Object.keys(newCoverUrls).length > 0) {
        setDropboxCoverUrls((prev) => ({ ...prev, ...newCoverUrls }));
      }

      return objectUrls;
    };

    let cancelled = false;
    let objectUrls: string[] = [];

    fetchCovers().then((urls) => {
      if (!urls) return;
      if (cancelled) {
        urls.forEach((url) => URL.revokeObjectURL(url));
      } else {
        objectUrls = urls;
      }
    });

    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [data]);

  const selectedEvent = useMemo(
    () => data?.events.find((event) => event.slug === eventSlug) ?? null,
    [eventSlug, data?.events],
  );

  const selectedAlbum = useMemo(
    () => data?.albums.find((album) => album.slug === albumSlug && album.event_id === selectedEvent?.id) ?? null,
    [albumSlug, selectedEvent, data?.albums],
  );

  useEffect(() => {
    if (selectedAlbum?.source_type !== 'dropbox' || !selectedAlbum.dropbox_folder_url) {
      setDropboxAlbumPhotos([]);
      return;
    }

    let cancelled = false;
    let objectUrls: string[] = [];
    const fetchAlbumPhotos = async () => {
      setIsDropboxLoading(true);
      try {
        const files = await fetchDropboxPhotos(selectedAlbum.dropbox_folder_url!);
        if (cancelled) return;

        setDropboxAlbumPhotos(files.map((file) => ({ id: file.id, src: '', alt: file.name, created_at: file.client_modified })));
        setIsDropboxLoading(false);

        files.forEach(async (file) => {
          try {
            const blob = await fetchDropboxFileBlob({
              folderUrl: selectedAlbum.dropbox_folder_url!,
              fileName: file.name,
            });
            const src = URL.createObjectURL(blob);
            if (cancelled) {
              URL.revokeObjectURL(src);
              return;
            }

            objectUrls.push(src);
            setDropboxAlbumPhotos((photos) =>
              photos.map((photo) => (photo.id === file.id ? { ...photo, src } : photo)),
            );
          } catch (e) {
            console.error(`Failed to fetch dropbox photo ${file.name}`, e);
          }
        });
      } catch (e) {
        console.error('Failed to fetch dropbox album photos', e);
        if (!cancelled) {
          setError('Could not load photos for this Dropbox album.');
        }
      } finally {
        if (!cancelled) {
          setIsDropboxLoading(false);
        }
      }
    };

    fetchAlbumPhotos();
    return () => {
      cancelled = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selectedAlbum]);

  const photosByAlbum = useMemo(() => {
    return (data?.photos ?? []).reduce<Record<string, GalleryPhoto[]>>((groups, photo) => {
      if (!photo.albumId) return groups;
      groups[photo.albumId] = [...(groups[photo.albumId] ?? []), photo];
      return groups;
    }, {});
  }, [data?.photos]);

  const photosByEvent = useMemo(() => {
    return (data?.photos ?? []).reduce<Record<string, GalleryPhoto[]>>((groups, photo) => {
      if (!photo.eventId) return groups;
      groups[photo.eventId] = [...(groups[photo.eventId] ?? []), photo];
      return groups;
    }, {});
  }, [data?.photos]);

  const activeAlbums = useMemo(
    () => (data?.albums ?? []).filter((album) => album.event_id === selectedEvent?.id),
    [data?.albums, selectedEvent],
  );

  const activePhotos = useMemo(() => {
    if (!selectedAlbum) return [];
    if (selectedAlbum.source_type === 'dropbox') {
      return dropboxAlbumPhotos;
    }
    return photosByAlbum[selectedAlbum.id] ?? [];
  }, [selectedAlbum, photosByAlbum, dropboxAlbumPhotos]);

  const sortedActivePhotos = usePhotoSort(activePhotos, photoSort);

  const handlePhotoClick = (index: number) => {
    requestPhotoFullscreen(fullscreenContainerRef.current);
    setSelectedPhotoIndex(index);
  };

  const handleCloseViewer = useCallback(async () => {
    await exitPhotoFullscreen();
    setSelectedPhotoIndex(null);
  }, []);

  const isAlbumPage = !!albumSlug;
  const isEventPage = !!eventSlug && !albumSlug;
  const isProfilePage = !eventSlug;
  
  const headerCover = useMemo(() => {
    if (!data) return null;

    if (isAlbumPage && selectedAlbum) {
      const album = selectedAlbum as any;
      if (album.dropbox_cover_image_name) {
        // For dropbox albums, activePhotos are already fetched. Find cover by name.
        return activePhotos.find(p => p.alt === album.dropbox_cover_image_name) ?? null;
      }
      if (album.cover_photo_id) {
        // For upload albums, find cover by id.
        return activePhotos.find(p => p.id === album.cover_photo_id) ?? null;
      }
      return null; // No explicit cover
    }

    if (isEventPage && selectedEvent) {
      const event = selectedEvent as any;
      if (event.dropbox_cover_album_id && event.dropbox_cover_image_name) {
        const coverInfo = dropboxCoverUrls[`event:${event.id}`];
        if (coverInfo) {
          return { id: `event-cover-${event.id}`, src: coverInfo.src, alt: coverInfo.name };
        }
        return null; // wait for fetch
      }
      if (event.cover_photo_id) {
        const eventPhotos = photosByEvent[selectedEvent.id] ?? [];
        return eventPhotos.find(p => p.id === event.cover_photo_id) ?? null;
      }
      return null; // No explicit cover
    }
    
    // Profile page logic
    const profile = data.profile as any;
    if (profile.dropbox_cover_album_id && profile.dropbox_cover_image_name) {
      return dropboxProfileCover;
    }
    if (profile.cover_photo_id) {
      return data.photos.find(p => p.id === profile.cover_photo_id) ?? null;
    }
    return null;
  }, [data, selectedAlbum, selectedEvent, activePhotos, photosByEvent, isAlbumPage, isEventPage, dropboxProfileCover, dropboxCoverUrls]);

  const profileLabel = data?.profile.display_name ?? data?.profile.slug ?? profileSlug;

  return (
    <div className="min-h-screen px-4 py-6">
      <header className="mx-auto mb-6 max-w-6xl">
        {headerCover && (
          <div className="mb-5 aspect-[4/1] overflow-hidden rounded-md bg-secondary">
            <StereoThumbnail photo={headerCover} />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xl font-light md:text-2xl">
            <Link to={`/${profileSlug}`} className="hover:underline">
              {profileLabel}
            </Link>
            {selectedEvent && (
              <>
                <span className="text-muted-foreground">/</span>
                {selectedAlbum ? (
                  <Link to={`/${profileSlug}/${selectedEvent.slug}`} className="hover:underline">
                    {selectedEvent.title}
                  </Link>
                ) : (
                  <span>{selectedEvent.title}</span>
                )}
              </>
            )}
            {selectedAlbum && (
              <>
                <span className="text-muted-foreground">/</span>
                <span>{selectedAlbum.title}</span>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {isAuthenticated ? (
              <Button asChild variant="secondary" className="gap-2">
                <Link to="/gallery">
                  <Images className="h-4 w-4" />
                  My Gallery
                </Link>
              </Button>
            ) : (
              <Button asChild variant="secondary" className="gap-2">
                <Link to="/login">
                  <User className="h-4 w-4" />
                  Login
                </Link>
              </Button>
            )}
            <Button asChild variant="secondary" className="gap-2">
              <Link to="/">
                <User className="h-4 w-4" />
                All Photographers
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl">
        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {isLoading && !data && !error && (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Loading public gallery...
          </div>
        )}

        {!isLoading && !data && !error && (
          <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
            Profile not found or is not public.
          </div>
        )}

        {data && isProfilePage && (
          <ThumbnailGrid
            items={data.events}
            sortOptions={COLLECTION_SORT_OPTIONS}
            emptyMessage="This photographer has no public events."
            renderItem={(event) => {
              const eventPhotos = photosByEvent[event.id] ?? [];
              let cover: GalleryPhoto | null = null;
              const e = event as any;

              if (e.dropbox_cover_album_id && e.dropbox_cover_image_name) {
                const coverInfo = dropboxCoverUrls[`event:${e.id}`];
                if (coverInfo) {
                  cover = { id: `event-cover-${e.id}`, src: coverInfo.src, alt: coverInfo.name };
                }
              } else {
                cover = getCoverPhoto(eventPhotos, event.cover_photo_id);
              }

              return (
                <Link key={event.id} to={`/${profileSlug}/${event.slug}`} className="group overflow-hidden rounded-md border border-border bg-card text-left transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring">
                  <div className="aspect-[3/2] bg-secondary">
                    {cover ? <StereoThumbnail photo={cover} /> : <div className="flex h-full w-full items-center justify-center"><FolderOpen className="h-6 w-6 text-muted-foreground" /></div>}
                  </div>
                  <div className="p-3">
                    <h2 className="truncate text-sm font-medium">{event.title}</h2>
                  </div>
                </Link>
              );
            }}
          />
        )}

        {data && isEventPage && selectedEvent && (
          <ThumbnailGrid
            items={activeAlbums}
            sortOptions={COLLECTION_SORT_OPTIONS}
            emptyMessage="This event has no public albums."
            renderItem={(album) => {
              const photos = photosByAlbum[album.id] ?? [];
              let cover: GalleryPhoto | null = null;
              const a = album as any;

              if (a.source_type === 'dropbox' && a.dropbox_cover_image_name) {
                const coverInfo = dropboxCoverUrls[`album:${a.id}`];
                if (coverInfo) {
                  cover = { id: `album-cover-${a.id}`, src: coverInfo.src, alt: coverInfo.name };
                }
              } else {
                cover = getCoverPhoto(photos, album.cover_photo_id);
              }

              return (
                <Link key={album.id} to={`/${profileSlug}/${selectedEvent.slug}/${album.slug}`} className="group overflow-hidden rounded-md border border-border bg-card text-left transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring">
                  <div className="aspect-[3/2] bg-secondary">
                    {cover ? <StereoThumbnail photo={cover} /> : <div className="flex h-full w-full items-center justify-center"><Images className="h-6 w-6 text-muted-foreground" /></div>}
                  </div>
                  <div className="p-3">
                    <h2 className="truncate text-sm font-medium">{album.title}</h2>
                    {album.source_type === 'dropbox' ? (
                      <p className="mt-1 flex items-center gap-1.5 text-xs font-medium text-sky-600 dark:text-sky-400">
                        <Cloud className="h-3 w-3" />
                        Dropbox Live
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</p>
                    )}
                  </div>
                </Link>
              );
            }}
          />
        )}

        {data && isAlbumPage && selectedAlbum && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-light">{selectedAlbum.title}</h2>
                <p className="text-sm text-muted-foreground">
                  {activePhotos.length} {activePhotos.length === 1 ? 'photo' : 'photos'}
                  {selectedAlbum.source_type === 'dropbox' && (
                    <span className="font-medium text-sky-600 dark:text-sky-400">
                      {' · '} <Cloud className="inline h-3 w-3" /> Dropbox Live
                    </span>
                  )}
                </p>
              </div>
            </div>
            {activePhotos.length > 1 && (
              <div className="flex items-center justify-start gap-2">
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
            {isDropboxLoading ? (
              <div className="flex items-center justify-center rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                <Cloud className="mr-2 h-4 w-4 animate-pulse" />
                Loading photos from Dropbox...
              </div>
            ) : sortedActivePhotos.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {sortedActivePhotos.map((photo, index) => (
                  <button
                    key={photo.id}
                    onClick={() => {
                      if (photo.src) handlePhotoClick(index);
                    }}
                    disabled={!photo.src}
                    className="group relative aspect-[2/1] overflow-hidden rounded-lg bg-secondary transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background disabled:cursor-wait disabled:hover:scale-100"
                  >
                    {photo.src ? (
                      <StereoThumbnail photo={photo} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Images className="h-6 w-6 text-muted-foreground/60" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">This album is empty.</div>
            )}
          </section>
        )}
      </main>

      {data && selectedPhotoIndex !== null && (() => {
        const isViewerOpen = selectedPhotoIndex !== null;
        const viewerProps = {
          album: selectedAlbum,
          photo: sortedActivePhotos[selectedPhotoIndex],
          photos: sortedActivePhotos,
          photoIndex: selectedPhotoIndex,
          onClose: handleCloseViewer,
          onPrevious: () => setSelectedPhotoIndex((index) => (index !== null && index > 0 ? index - 1 : index)),
          onNext: () => setSelectedPhotoIndex((index) => (index !== null && index < sortedActivePhotos.length - 1 ? index + 1 : index)),
          hasPrevious: selectedPhotoIndex > 0,
          hasNext: selectedPhotoIndex < sortedActivePhotos.length - 1,
        };
        return (
          <div
            ref={fullscreenContainerRef}
            className={`fixed inset-0 z-50 bg-black ${isViewerOpen ? 'block' : 'hidden'}`}
          >
            {isViewerOpen && <SmartViewer {...viewerProps} />}
          </div>
        );
      })()}
    </div>
  );
}
