import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Camera } from 'lucide-react';

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  if (user) {
    const destination = user.role === 'admin' ? '/admin' : `/user/${user.username}`;
    return <Navigate to={destination} replace />;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const loggedInUser = login(username, password);
    if (loggedInUser) {
      const destination =
        loggedInUser.role === 'admin' ? '/admin' : `/user/${loggedInUser.username}`;
      navigate(destination);
      return;
    }

    setError('Incorrect username or password');
    setPassword('');
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        <div className="flex justify-center">
          <div className="rounded-full bg-secondary p-4">
            <Camera className="h-12 w-12 text-foreground" />
          </div>
        </div>

        <div className="text-center">
          <h1 className="text-3xl font-light tracking-wide text-foreground">
            StereoViewer Login
          </h1>
          <p className="mt-2 text-muted-foreground">
            Enter your username and password to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="h-12 bg-secondary text-center text-lg"
              autoFocus
            />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 bg-secondary text-center text-lg tracking-widest"
            />
            {error && (
              <p className="text-center text-sm text-destructive">{error}</p>
            )}
          </div>

          <Button
            type="submit"
            className="h-12 w-full text-lg"
            disabled={!username || !password}
          >
            Log In
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground">
          Admin starter account: <span className="font-medium text-foreground">admin</span> / admin123
        </p>
      </div>
    </div>
  );
}
