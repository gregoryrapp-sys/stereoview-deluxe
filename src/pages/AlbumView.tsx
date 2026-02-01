import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { getAlbumById, getAlbumPhotos } from '@/data/albums';
import { users } from '@/data/users';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Lock } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function AlbumView() {
  const { albumId } = useParams<{ albumId: string }>();
  const { user } = useAuth();
  const album = useMemo(() => (albumId ? getAlbumById(albumId) : undefined), [albumId]);
  const [passcode, setPasscode] = useState('');
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [showError, setShowError] = useState(false);

  if (!album) {
    return <Navigate to="/" replace />;
  }

  const creator = users.find((entry) => entry.id === album.creatorId);
  const albumPhotos = getAlbumPhotos(album);
  const isOwner = user?.role === 'admin' || user?.username === creator?.username;
  const requiresPasscode = !album.isPublic && !isOwner;
  const canView = !requiresPasscode || isUnlocked;

  const handleUnlock = (event: React.FormEvent) => {
    event.preventDefault();
    if (passcode && passcode === album.password) {
      setIsUnlocked(true);
      setShowError(false);
      return;
    }
    setShowError(true);
  };

  return (
    <div className="min-h-screen px-6 py-8">
      <header className="mx-auto flex max-w-5xl flex-col gap-3 rounded-2xl border border-border bg-card px-6 py-5">
        <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
          StereoViewer - {creator?.name ?? 'Unknown creator'}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-light">{album.name}</h1>
          <Button asChild variant="outline" size="sm">
            <Link to={creator ? `/user/${creator.username}` : '/'}>Back to albums</Link>
          </Button>
        </div>
      </header>

      {requiresPasscode && !canView && (
        <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-border bg-card px-6 py-8 text-center">
          <Lock className="mx-auto h-10 w-10 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-light">Private Album</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the passcode shared by the album owner to view these photos.
          </p>
          <form onSubmit={handleUnlock} className="mt-6 space-y-3">
            <Input
              type="password"
              placeholder="Passcode"
              value={passcode}
              onChange={(event) => {
                setPasscode(event.target.value);
                setShowError(false);
              }}
            />
            <Button type="submit" className="w-full">
              Unlock album
            </Button>
          </form>
          {showError && (
            <p className="mt-3 text-xs text-destructive">Incorrect passcode.</p>
          )}
        </div>
      )}

      {canView && (
        <section className="mx-auto mt-8 max-w-5xl">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Album photos</h2>
            <p className="text-sm text-muted-foreground">{albumPhotos.length} photos</p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {albumPhotos.map((photo) => (
              <Link
                key={photo.id}
                to={`/viewer/${album.id}/${photo.id}`}
                className="group overflow-hidden rounded-lg border border-border bg-secondary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              >
                <img
                  src={photo.src}
                  alt={photo.alt}
                  className="h-48 w-[200%] object-cover object-left transition-transform duration-300 group-hover:scale-[1.02]"
                  loading="lazy"
                />
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
