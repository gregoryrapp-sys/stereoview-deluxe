import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AlbumEntry {
  name: string;
  dropboxLink: string;
  createdAt: string;
}

const getAlbumsStorageKey = (username: string) =>
  `stereoViewerAlbums:${username}`;

export default function UserDashboard() {
  const { currentUser, logout } = useAuth();
  const navigate = useNavigate();
  const [albumName, setAlbumName] = useState('');
  const [dropboxLink, setDropboxLink] = useState('');
  const [error, setError] = useState('');
  const [albums, setAlbums] = useState<AlbumEntry[]>([]);

  useEffect(() => {
    if (!currentUser) {
      navigate('/');
      return;
    }
    if (currentUser.role === 'admin') {
      navigate('/admin');
      return;
    }
    const storedAlbums = localStorage.getItem(
      getAlbumsStorageKey(currentUser.username)
    );
    if (storedAlbums) {
      try {
        setAlbums(JSON.parse(storedAlbums) as AlbumEntry[]);
      } catch {
        setAlbums([]);
      }
    }
  }, [currentUser, navigate]);

  const sortedAlbums = useMemo(
    () =>
      [...albums].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ),
    [albums]
  );

  const persistAlbums = (nextAlbums: AlbumEntry[]) => {
    if (!currentUser) {
      return;
    }
    localStorage.setItem(
      getAlbumsStorageKey(currentUser.username),
      JSON.stringify(nextAlbums)
    );
  };

  const handleAddAlbum = (event: React.FormEvent) => {
    event.preventDefault();
    setError('');

    if (!albumName.trim() || !dropboxLink.trim()) {
      setError('Please provide both an album name and a Dropbox share link.');
      return;
    }

    const nextAlbums = [
      ...albums,
      {
        name: albumName.trim(),
        dropboxLink: dropboxLink.trim(),
        createdAt: new Date().toISOString(),
      },
    ];
    setAlbums(nextAlbums);
    persistAlbums(nextAlbums);
    setAlbumName('');
    setDropboxLink('');
  };

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-widest text-muted-foreground">
              StereoViewer
            </p>
            <h1 className="text-3xl font-light text-foreground">
              Welcome, {currentUser?.username}
            </h1>
          </div>
          <Button variant="outline" onClick={handleLogout}>
            Log out
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Create a new album</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleAddAlbum}>
              <div className="space-y-2">
                <Label htmlFor="album-name">Album name</Label>
                <Input
                  id="album-name"
                  value={albumName}
                  onChange={(event) => setAlbumName(event.target.value)}
                  placeholder="e.g. Summer stereo captures"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dropbox-link">Dropbox folder share link</Label>
                <Input
                  id="dropbox-link"
                  value={dropboxLink}
                  onChange={(event) => setDropboxLink(event.target.value)}
                  placeholder="https://www.dropbox.com/scl/fo/..."
                />
                <p className="text-sm text-muted-foreground">
                  Use a Dropbox folder sharing link so StereoViewer can access the
                  photos in that folder (no tokens required).
                </p>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit">Create album</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your albums</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sortedAlbums.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                You have not created any albums yet.
              </p>
            ) : (
              <ul className="space-y-3">
                {sortedAlbums.map((album) => (
                  <li
                    key={`${album.name}-${album.createdAt}`}
                    className="rounded-lg border border-border/60 bg-secondary/30 p-4"
                  >
                    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-lg font-medium text-foreground">
                          {album.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          Added {new Date(album.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <a
                        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                        href={album.dropboxLink}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open Dropbox folder
                      </a>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
