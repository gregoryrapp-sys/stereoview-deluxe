import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Lock, Unlock } from 'lucide-react';
import StereoViewer from '@/components/StereoViewer';
import StereoThumbnail from '@/components/StereoThumbnail';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fetchSharedGalleryBySlugs, GalleryPhoto, SharedGalleryData } from '@/services/galleryService';

function getCoverPhoto(photos: GalleryPhoto[], coverPhotoId?: string | null) {
  return photos.find((photo) => photo.id === coverPhotoId) ?? photos[0] ?? null;
}

export default function PublicGallery() {
  const { profileSlug = '', eventSlug = null, albumSlug = null } = useParams();
  const [password, setPassword] = useState('');
  const [sharedData, setSharedData] = useState<SharedGalleryData | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasTriedPublicOpen, setHasTriedPublicOpen] = useState(false);

  const selectedEvent = useMemo(
    () => sharedData?.events.find((event) => event.slug === eventSlug) ?? sharedData?.events[0] ?? null,
    [eventSlug, sharedData?.events],
  );

  const selectedAlbum = useMemo(
    () => sharedData?.albums.find((album) => album.slug === albumSlug) ?? sharedData?.albums[0] ?? null,
    [albumSlug, sharedData?.albums],
  );

  const photosByAlbum = useMemo(() => {
    return (sharedData?.photos ?? []).reduce<Record<string, GalleryPhoto[]>>((groups, photo) => {
      if (!photo.albumId) return groups;
      groups[photo.albumId] = [...(groups[photo.albumId] ?? []), photo];
      return groups;
    }, {});
  }, [sharedData?.photos]);

  const albumPhotos = selectedAlbum ? photosByAlbum[selectedAlbum.id] ?? [] : [];
  const isAlbumPage = !!albumSlug;
  const isEventPage = !!eventSlug && !albumSlug;
  const isProfilePage = !eventSlug;
  const headerCover = sharedData
    ? isAlbumPage && selectedAlbum
      ? getCoverPhoto(albumPhotos, selectedAlbum.cover_photo_id)
      : selectedEvent
        ? getCoverPhoto(
            sharedData.photos.filter((photo) => photo.eventId === selectedEvent.id),
            selectedEvent.cover_photo_id,
          )
        : getCoverPhoto(sharedData.photos, sharedData.profile.cover_photo_id)
    : null;

  const openSharedGallery = async (passwordValue: string) => {
    setError('');
    setIsLoading(true);

    try {
      const data = await fetchSharedGalleryBySlugs({
        profileSlug,
        eventSlug,
        albumSlug,
        password: passwordValue,
      });
      setSharedData(data);
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : 'Could not open this shared gallery');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (hasTriedPublicOpen || sharedData) return;
    setHasTriedPublicOpen(true);
    openSharedGallery('');
  }, [hasTriedPublicOpen, sharedData]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    openSharedGallery(password);
  };

  if (!sharedData) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 rounded-full bg-secondary p-3">
              <Lock className="h-6 w-6" />
            </div>
            <CardTitle>{isLoading ? 'Opening Gallery' : 'Shared Gallery'}</CardTitle>
            <CardDescription>
              {isLoading ? 'Checking access...' : 'Enter the event password if this shared page requires one.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUnlock} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="share-password">Password</Label>
                <Input
                  id="share-password"
                  type="text"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoFocus
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
              <Button type="submit" className="w-full gap-2" disabled={isLoading}>
                <Unlock className="h-4 w-4" />
                {isLoading ? 'Opening...' : 'Open Gallery'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6">
      <header className="mx-auto mb-6 max-w-6xl">
        {headerCover && (
          <div className="mb-5 aspect-[4/1] overflow-hidden rounded-md bg-secondary">
            <StereoThumbnail photo={headerCover} />
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Shared by</p>
            <h1 className="text-3xl font-light tracking-wide">
              {sharedData.profile.display_name ?? sharedData.profile.slug}
            </h1>
            {selectedEvent && !isProfilePage && (
              <p className="mt-1 text-sm text-muted-foreground">{selectedEvent.title}</p>
            )}
          </div>
          {!isProfilePage && (
            <Button asChild variant="secondary" className="gap-2">
              <Link to={isAlbumPage && selectedEvent ? `/${profileSlug}/${selectedEvent.slug}` : `/${profileSlug}`}>
                <ArrowLeft className="h-4 w-4" />
                Back
              </Link>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl">
        {isProfilePage && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sharedData.events.map((eventRecord) => {
              const eventAlbums = sharedData.albums.filter((album) => album.event_id === eventRecord.id);
              const eventPhotos = sharedData.photos.filter((photo) => photo.eventId === eventRecord.id);
              const cover = getCoverPhoto(eventPhotos, eventRecord.cover_photo_id);

              return (
                <Link
                  key={eventRecord.id}
                  to={`/${profileSlug}/${eventRecord.slug}`}
                  className="group overflow-hidden rounded-md border border-border bg-card"
                >
                  <div className="aspect-[3/2] bg-secondary">
                    {cover && <StereoThumbnail photo={cover} />}
                  </div>
                  <div className="p-4">
                    <h2 className="truncate text-lg font-medium">{eventRecord.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {eventAlbums.length} {eventAlbums.length === 1 ? 'album' : 'albums'}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {isEventPage && selectedEvent && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sharedData.albums.map((album) => {
              const photos = photosByAlbum[album.id] ?? [];
              const cover = getCoverPhoto(photos, album.cover_photo_id);

              return (
                <Link
                  key={album.id}
                  to={`/${profileSlug}/${selectedEvent.slug}/${album.slug}`}
                  className="group overflow-hidden rounded-md border border-border bg-card"
                >
                  <div className="aspect-[3/2] bg-secondary">
                    {cover && <StereoThumbnail photo={cover} />}
                  </div>
                  <div className="p-4">
                    <h2 className="truncate text-lg font-medium">{album.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {photos.length} {photos.length === 1 ? 'photo' : 'photos'}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {isAlbumPage && selectedAlbum && (
          <section className="space-y-4">
            <div>
              <h2 className="text-2xl font-light">{selectedAlbum.title}</h2>
              <p className="text-sm text-muted-foreground">
                {albumPhotos.length} {albumPhotos.length === 1 ? 'photo' : 'photos'}
              </p>
            </div>
            {albumPhotos.length > 0 ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {albumPhotos.map((photo, index) => (
                  <button
                    key={photo.id}
                    onClick={() => setSelectedPhotoIndex(index)}
                    className="group relative aspect-[2/1] overflow-hidden rounded-lg bg-secondary transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
                  >
                    <StereoThumbnail photo={photo} />
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground">
                This shared album does not have photos yet.
              </div>
            )}
          </section>
        )}
      </main>

      {selectedPhotoIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black">
          <StereoViewer
            album={selectedAlbum}
            photo={albumPhotos[selectedPhotoIndex]}
            photos={albumPhotos}
            photoIndex={selectedPhotoIndex}
            onClose={() => setSelectedPhotoIndex(null)}
            onPrevious={() => setSelectedPhotoIndex((index) => (index !== null && index > 0 ? index - 1 : index))}
            onNext={() =>
              setSelectedPhotoIndex((index) =>
                index !== null && index < albumPhotos.length - 1 ? index + 1 : index,
              )
            }
            hasPrevious={selectedPhotoIndex > 0}
            hasNext={selectedPhotoIndex < albumPhotos.length - 1}
          />
        </div>
      )}
    </div>
  );
}
