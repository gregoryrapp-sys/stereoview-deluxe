import { useEffect, useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getAlbums } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ArrowLeft, RefreshCcw } from 'lucide-react';
import { useDropboxPhotos } from '@/hooks/useDropboxPhotos';

export default function AlbumDetail() {
  const { albumId } = useParams();
  const { isAuthenticated, currentUser, isAdmin } = useAuth();
  const albums = useMemo(() => getAlbums(), []);
  const album = albums.find((entry) => entry.id === albumId);
  const { photos, isLoading, error, loadPhotos } = useDropboxPhotos();

  useEffect(() => {
    if (album?.dropboxFolderUrl) {
      loadPhotos(album.dropboxFolderUrl);
    }
  }, [album?.dropboxFolderUrl, loadPhotos]);

  if (!isAuthenticated || !currentUser) {
    return <Navigate to="/" replace />;
  }

  if (!album) {
    return <Navigate to="/gallery" replace />;
  }

  if (!isAdmin && album.userId !== currentUser.id) {
    return <Navigate to="/gallery" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/90 px-4 py-4 backdrop-blur-sm">
        <div>
          <h1 className="text-xl font-light tracking-wide">{album.title}</h1>
          <p className="text-sm text-muted-foreground">Dropbox folder: {album.dropboxFolderUrl}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/gallery" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadPhotos(album.dropboxFolderUrl)} disabled={isLoading}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </header>

      <main className="px-4 py-8">
        {error && (
          <Card className="mb-6 border-destructive/50 bg-destructive/10">
            <CardContent className="py-4 text-sm text-destructive">{error}</CardContent>
          </Card>
        )}

        {isLoading && photos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Loading photos from Dropbox…</p>
        ) : photos.length === 0 ? (
          <Card className="border-dashed border-muted-foreground/40 bg-muted/30">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No photos found in this Dropbox folder yet.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map((photo) => (
              <div key={photo.id} className="overflow-hidden rounded-lg border border-border bg-card">
                <img src={photo.src} alt={photo.name} className="h-48 w-full object-cover" />
                <div className="px-3 py-2 text-xs text-muted-foreground">{photo.name}</div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
