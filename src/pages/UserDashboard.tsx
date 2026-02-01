import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Album, getUserAlbums } from '@/data/albums';
import { users } from '@/data/users';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogOut, PlusCircle } from 'lucide-react';

export default function UserDashboard() {
  const { username } = useParams<{ username: string }>();
  const { user, logout } = useAuth();
  const [customAlbums, setCustomAlbums] = useState<Album[]>([]);
  const [albumName, setAlbumName] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [password, setPassword] = useState('');

  const account = users.find((entry) => entry.username === username);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!account) {
    return <Navigate to="/" replace />;
  }

  if (user.role !== 'admin' && user.username !== account.username) {
    return <Navigate to={`/user/${user.username}`} replace />;
  }

  const baseAlbums = getUserAlbums(account.id);
  const userAlbums = useMemo(
    () => [...baseAlbums, ...customAlbums],
    [baseAlbums, customAlbums]
  );

  const handleCreateAlbum = (event: React.FormEvent) => {
    event.preventDefault();
    if (!albumName.trim()) return;

    const newAlbum: Album = {
      id: `album-${Date.now()}`,
      name: albumName.trim(),
      creatorId: account.id,
      isPublic,
      password: isPublic ? undefined : password || 'private',
      photoIds: [],
    };

    setCustomAlbums((prev) => [newAlbum, ...prev]);
    setAlbumName('');
    setIsPublic(true);
    setPassword('');
  };

  return (
    <div className="min-h-screen px-6 py-8">
      <header className="mx-auto flex max-w-5xl items-center justify-between rounded-2xl border border-border bg-card px-6 py-5">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
            StereoViewer - {account.name}
          </p>
          <h1 className="text-2xl font-light">Create Albums</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={logout}>
          <LogOut className="h-5 w-5" />
        </Button>
      </header>

      <main className="mx-auto mt-8 grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-medium">
              <PlusCircle className="h-4 w-4" />
              Create a new album
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleCreateAlbum}>
              <Input
                placeholder="Album name"
                value={albumName}
                onChange={(event) => setAlbumName(event.target.value)}
              />
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">Public album</p>
                  <p className="text-xs text-muted-foreground">
                    Toggle off to require a passcode.
                  </p>
                </div>
                <Switch checked={isPublic} onCheckedChange={setIsPublic} />
              </div>
              {!isPublic && (
                <Input
                  placeholder="Private album passcode"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}
              <Button type="submit" className="w-full sm:w-auto">
                Create album
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-medium">Your albums</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {userAlbums.length === 0 && (
              <p className="text-muted-foreground">
                No albums yet. Use the form to create your first album.
              </p>
            )}
            {userAlbums.map((album) => (
              <div
                key={album.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary px-3 py-3"
              >
                <div>
                  <p className="font-medium text-foreground">{album.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {album.isPublic ? 'Public' : 'Private'} · {album.photoIds.length} photos
                  </p>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to={`/album/${album.id}`}>Go</Link>
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
