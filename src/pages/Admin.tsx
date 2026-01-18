import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { UserAccount } from '@/lib/types';
import { getAlbums, getSettings, getUsers, saveSettings, saveUsers } from '@/lib/storage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogOut, Settings, ShieldCheck, Users } from 'lucide-react';

const createUserId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `user-${Date.now()}`;
};

export default function Admin() {
  const { isAuthenticated, isAdmin, logout } = useAuth();
  const [users, setUsers] = useState<UserAccount[]>(getUsers());
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [error, setError] = useState('');
  const [accessToken, setAccessToken] = useState(getSettings().dropboxAccessToken);
  const albumCount = useMemo(() => getAlbums().length, []);

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/gallery" replace />;
  }

  const handleCreateUser = () => {
    setError('');
    if (!username || !displayName || !password) {
      setError('All fields are required.');
      return;
    }

    if (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) {
      setError('That username is already taken.');
      return;
    }

    const nextUsers = [
      ...users,
      {
        id: createUserId(),
        username,
        displayName,
        password,
        role
      }
    ];

    setUsers(nextUsers);
    saveUsers(nextUsers);
    setUsername('');
    setDisplayName('');
    setPassword('');
    setRole('user');
  };

  const handleSaveToken = () => {
    saveSettings({ dropboxAccessToken: accessToken });
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/90 px-4 py-4 backdrop-blur-sm">
        <div>
          <h1 className="text-xl font-light tracking-wide">Admin Center</h1>
          <p className="text-sm text-muted-foreground">Manage users and Dropbox connectivity</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/gallery" className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              Albums
            </Link>
          </Button>
          <Button variant="ghost" size="icon" onClick={logout} className="text-muted-foreground hover:text-foreground">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="grid gap-6 px-4 py-8 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                User accounts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input id="username" value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display name</Label>
                  <Input id="displayName" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select value={role} onValueChange={(value) => setRole(value as 'admin' | 'user')}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button onClick={handleCreateUser}>Create user</Button>

              <div className="border-t border-border pt-4">
                <h3 className="text-sm font-medium text-foreground">Existing users</h3>
                <div className="mt-3 space-y-2 text-sm">
                  {users.map((user) => (
                    <div key={user.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                      <div>
                        <p className="font-medium text-foreground">{user.displayName}</p>
                        <p className="text-xs text-muted-foreground">@{user.username}</p>
                      </div>
                      <span className="rounded-full bg-secondary px-2 py-1 text-xs text-muted-foreground">
                        {user.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Dropbox settings
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Label htmlFor="dropbox-token">Access token</Label>
              <Input
                id="dropbox-token"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="Dropbox API access token"
              />
              <p className="text-xs text-muted-foreground">
                Store a Dropbox API access token that has access to the folders you want to list.
              </p>
              <Button onClick={handleSaveToken}>Save token</Button>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Quick stats</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Total users: <span className="font-medium text-foreground">{users.length}</span>
              </p>
              <p>
                Total albums: <span className="font-medium text-foreground">{albumCount}</span>
              </p>
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}
