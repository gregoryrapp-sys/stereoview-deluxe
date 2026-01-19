import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { LogOut, Plus, Image as ImageIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useAlbums } from '@/contexts/AlbumContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function UserDashboard() {
  const { isAuthenticated, logout, username } = useAuth();
  const { albums, addAlbum } = useAlbums();
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [dropboxFolderLink, setDropboxFolderLink] = useState('');
  const [coverImage, setCoverImage] = useState<string | undefined>(undefined);
  const [error, setError] = useState('');

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleCoverChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setCoverImage(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!title.trim() || !dropboxFolderLink.trim()) {
      setError('Album name and Dropbox folder link are required.');
      return;
    }

    addAlbum({
      title: title.trim(),
      dropboxFolderLink: dropboxFolderLink.trim(),
      coverImage
    });

    setTitle('');
    setDropboxFolderLink('');
    setCoverImage(undefined);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-background/80 px-4 py-4 backdrop-blur-sm">
        <div>
          <p className="text-sm text-muted-foreground">Welcome back</p>
          <h1 className="text-xl font-light tracking-wide">
            {username ? `${username}'s Albums` : 'Your Albums'}
          </h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={logout}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Log out"
        >
          <LogOut className="h-5 w-5" />
        </Button>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-12 pt-6">
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <div className="mb-6 flex items-center gap-2">
            <Plus className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-medium">Create a new album</h2>
          </div>
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-[2fr,2fr,1fr,auto] md:items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Album name</label>
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Summer Getaway"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Dropbox folder link</label>
              <Input
                value={dropboxFolderLink}
                onChange={(event) => setDropboxFolderLink(event.target.value)}
                placeholder="https://www.dropbox.com/sh/..."
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Cover image</label>
              <div className="flex items-center gap-3">
                <label className="flex h-10 w-full cursor-pointer items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground transition hover:border-primary">
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleCoverChange}
                  />
                  Upload
                </label>
                {coverImage && (
                  <img
                    src={coverImage}
                    alt="Cover preview"
                    className="h-10 w-10 rounded-md object-cover"
                  />
                )}
              </div>
            </div>
            <Button type="submit" className="w-full md:w-auto">
              Add album
            </Button>
          </form>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-medium">Your albums</h2>
          {albums.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No albums yet. Add one above to start sharing photos.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {albums.map((album) => (
                <button
                  key={album.id}
                  onClick={() => navigate(`/album/${album.id}`)}
                  className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left shadow-sm transition hover:-translate-y-1 hover:shadow-md"
                >
                  <div className="relative h-40 bg-secondary">
                    {album.coverImage ? (
                      <img
                        src={album.coverImage}
                        alt={album.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-muted-foreground">
                        <ImageIcon className="h-8 w-8" />
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-2 p-4">
                    <h3 className="text-base font-medium group-hover:text-primary">{album.title}</h3>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {album.dropboxFolderLink}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
