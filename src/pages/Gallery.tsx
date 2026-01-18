import { useCallback, useMemo, useState, useEffect } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Album, DropboxPhoto } from '@/lib/types';
import { getAlbums, getSettings, saveAlbums } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ImagePlus, LogOut, PlusCircle, ShieldCheck } from 'lucide-react';
import { getTemporaryLink } from '@/lib/dropbox';
import { useDropboxPhotos } from '@/hooks/useDropboxPhotos';

const createAlbumId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `album-${Date.now()}`;
};

export default function Gallery() {
  const { isAuthenticated, currentUser, isAdmin, logout } = useAuth();
  const [albums, setAlbums] = useState<Album[]>(getAlbums());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [folderUrl, setFolderUrl] = useState('');
  const [coverPhoto, setCoverPhoto] = useState<DropboxPhoto | null>(null);
  const [previewError, setPreviewError] = useState('');
  const { photos, isLoading, error, loadPhotos } = useDropboxPhotos();

  const userAlbums = useMemo(() => {
    if (!currentUser) return [];
    return albums.filter((album) => album.userId === currentUser.id);
  }, [albums, currentUser]);

  const [coverLinks, setCoverLinks] = useState<Record<string, string>>({});

  const refreshCoverLinks = useCallback(async () => {
    const settings = getSettings();
    if (!settings.dropboxAccessToken) {
      setCoverLinks({});
      return;
    }

    const entries = await Promise.all(
      userAlbums.map(async (album) => {
        if (!album.coverPhotoPath) return [album.id, ''] as const;
        try {
          const link = await getTemporaryLink(settings.dropboxAccessToken, album.coverPhotoPath);
          return [album.id, link] as const;
        } catch {
          return [album.id, ''] as const;
        }
      })
    );

    setCoverLinks(Object.fromEntries(entries));
  }, [userAlbums]);

  useEffect(() => {
    refreshCoverLinks();
  }, [refreshCoverLinks]);

  if (!isAuthenticated || !currentUser) {
    return <Navigate to="/" replace />;
  }

  const handleOpenDialog = () => {
    setTitle('');
    setFolderUrl('');
    setCoverPhoto(null);
    setPreviewError('');
    setIsDialogOpen(true);
  };

  const handlePreview = async () => {
    setPreviewError('');
    if (!folderUrl) {
      setPreviewError('Enter a Dropbox folder link or path first.');
      return;
    }
    const settings = getSettings();
    if (!settings.dropboxAccessToken) {
      setPreviewError('Add a Dropbox access token in the admin settings to preview photos.');
      return;
    }
    const loaded = await loadPhotos(folderUrl);
    if (loaded.length > 0 && !coverPhoto) {
      setCoverPhoto(loaded[0]);
    }
  };

  const handleCreateAlbum = () => {
    if (!title || !folderUrl) {
      setPreviewError('Title and Dropbox folder link are required.');
      return;
    }

    const newAlbum: Album = {
      id: createAlbumId(),
      userId: currentUser.id,
      title,
      dropboxFolderUrl: folderUrl,
      coverPhotoPath: coverPhoto?.path,
      coverPhotoName: coverPhoto?.name,
      createdAt: new Date().toISOString()
    };

    const nextAlbums = [...albums, newAlbum];
    setAlbums(nextAlbums);
    saveAlbums(nextAlbums);
    setIsDialogOpen(false);
    refreshCoverLinks();
  };

  const coverInfo = (album: Album) => {
    if (!album.coverPhotoPath) return 'No cover photo set';
    return album.coverPhotoName || 'Cover photo selected';
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/90 px-4 py-4 backdrop-blur-sm">
        <div>
          <h1 className="text-xl font-light tracking-wide">Your Albums</h1>
          <p className="text-sm text-muted-foreground">Signed in as {currentUser.displayName}</p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin" className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />
                Admin
              </Link>
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={logout} className="text-muted-foreground hover:text-foreground">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-foreground">Albums</h2>
            <p className="text-sm text-muted-foreground">Create albums from Dropbox folders and pick a cover image.</p>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={handleOpenDialog} className="flex items-center gap-2">
                <PlusCircle className="h-4 w-4" />
                New album
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Create a new album</DialogTitle>
              </DialogHeader>
              <div className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="album-title">Album title</Label>
                    <Input id="album-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer trip" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="album-folder">Dropbox folder link</Label>
                    <Input
                      id="album-folder"
                      value={folderUrl}
                      onChange={(e) => setFolderUrl(e.target.value)}
                      placeholder="/Photos/Trips/2024"
                    />
                  </div>
                </div>

                <div className="rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 p-4 text-sm text-muted-foreground">
                  <p>Tip: Use a Dropbox folder path (like /Photos/Albums) or a share link that your token can access.</p>
                </div>

                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <Label className="text-sm">Choose a cover photo</Label>
                      <p className="text-xs text-muted-foreground">Load photos to select a cover image.</p>
                    </div>
                    <Button variant="outline" size="sm" onClick={handlePreview} disabled={!folderUrl || isLoading}>
                      {isLoading ? 'Loading…' : 'Load photos'}
                    </Button>
                  </div>
                  {previewError && <p className="text-sm text-destructive">{previewError}</p>}
                  {error && <p className="text-sm text-destructive">{error}</p>}

                  {photos.length > 0 ? (
                    <div className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                      {photos.map((photo) => (
                        <button
                          key={photo.id}
                          type="button"
                          onClick={() => setCoverPhoto(photo)}
                          className={`group relative overflow-hidden rounded-lg border transition ${
                            coverPhoto?.id === photo.id
                              ? 'border-primary ring-2 ring-primary/40'
                              : 'border-border hover:border-primary/60'
                          }`}
                        >
                          <img src={photo.src} alt={photo.name} className="h-24 w-full object-cover" />
                          <span className="absolute inset-x-0 bottom-0 bg-background/70 px-2 py-1 text-xs text-foreground">
                            {photo.name}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <ImagePlus className="h-4 w-4" />
                      No preview loaded yet.
                    </div>
                  )}
                </div>

                {coverPhoto && (
                  <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm">
                    <p className="font-medium text-foreground">Selected cover</p>
                    <p className="text-muted-foreground">{coverPhoto.name}</p>
                  </div>
                )}
              </div>
              <DialogFooter className="mt-6">
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreateAlbum} disabled={!title || !folderUrl}>
                  Create album
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {userAlbums.length === 0 && (
            <div className="rounded-lg border border-dashed border-muted-foreground/40 bg-muted/30 p-6 text-center text-sm text-muted-foreground">
              Create your first album to start displaying Dropbox photos.
            </div>
          )}
          {userAlbums.map((album) => (
            <Link
              to={`/albums/${album.id}`}
              key={album.id}
              className="group relative overflow-hidden rounded-xl border border-border bg-card transition hover:-translate-y-1 hover:shadow-lg"
              onMouseEnter={() => {
                if (!coverLinks[album.id]) {
                  refreshCoverLinks();
                }
              }}
            >
              <div className="aspect-[4/3] bg-muted">
                {coverLinks[album.id] ? (
                  <img src={coverLinks[album.id]} alt={album.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No cover loaded</div>
                )}
              </div>
              <div className="space-y-1 px-4 py-3">
                <h3 className="text-base font-medium text-foreground">{album.title}</h3>
                <p className="text-xs text-muted-foreground">{coverInfo(album)}</p>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
