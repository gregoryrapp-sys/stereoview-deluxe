import { useMemo, useState } from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { users as seedUsers, UserRole } from '@/data/users';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LogOut, UserPlus } from 'lucide-react';

interface NewUserForm {
  name: string;
  username: string;
  role: UserRole;
  password: string;
}

export default function Admin() {
  const { user, logout } = useAuth();
  const [users, setUsers] = useState(seedUsers);
  const [formData, setFormData] = useState<NewUserForm>({
    name: '',
    username: '',
    role: 'user',
    password: '',
  });

  const admins = useMemo(() => users.filter((item) => item.role === 'admin'), [users]);
  const regularUsers = useMemo(() => users.filter((item) => item.role === 'user'), [users]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (user.role !== 'admin') {
    return <Navigate to={`/user/${user.username}`} replace />;
  }

  const handleChange = (field: keyof NewUserForm, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!formData.name || !formData.username || !formData.password) return;

    setUsers((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        name: formData.name,
        username: formData.username,
        role: formData.role,
        password: formData.password,
      },
    ]);
    setFormData({ name: '', username: '', role: 'user', password: '' });
  };

  return (
    <div className="min-h-screen px-6 py-8">
      <header className="mx-auto flex max-w-5xl items-center justify-between rounded-2xl border border-border bg-card px-6 py-5">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
            StereoViewer - Admin
          </p>
          <h1 className="text-2xl font-light">Create or manage users</h1>
        </div>
        <Button variant="ghost" size="icon" onClick={logout}>
          <LogOut className="h-5 w-5" />
        </Button>
      </header>

      <main className="mx-auto mt-8 grid max-w-5xl gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-medium">
              <UserPlus className="h-4 w-4" />
              Add new user
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <Input
                placeholder="Full name"
                value={formData.name}
                onChange={(event) => handleChange('name', event.target.value)}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  placeholder="Username"
                  value={formData.username}
                  onChange={(event) => handleChange('username', event.target.value)}
                />
                <Input
                  placeholder="Temporary password"
                  value={formData.password}
                  onChange={(event) => handleChange('password', event.target.value)}
                  type="password"
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="role"
                    value="user"
                    checked={formData.role === 'user'}
                    onChange={() => handleChange('role', 'user')}
                  />
                  User
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="role"
                    value="admin"
                    checked={formData.role === 'admin'}
                    onChange={() => handleChange('role', 'admin')}
                  />
                  Admin
                </label>
              </div>
              <Button type="submit" className="w-full sm:w-auto">
                Create user
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-medium">User credentials</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 text-sm">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Admins
              </p>
              <div className="mt-2 space-y-2">
                {admins.map((admin) => (
                  <div key={admin.id} className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2">
                    <span>{admin.name}</span>
                    <span className="text-muted-foreground">{admin.username}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Users
              </p>
              <div className="mt-2 space-y-2">
                {regularUsers.map((regular) => (
                  <div key={regular.id} className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2">
                    <span>{regular.name}</span>
                    <Link
                      to={`/user/${regular.username}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {regular.username}
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
