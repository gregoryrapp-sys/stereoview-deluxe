import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Camera } from 'lucide-react';
import { getUsers } from '@/lib/storage';

export default function Landing() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const user = login(username, password);
    if (user) {
      navigate(user.role === 'admin' ? '/admin' : '/gallery');
    } else {
      setError('Incorrect username or password');
      setPassword('');
    }
  };

  const hasOnlyAdmin = getUsers().length === 1;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo/Icon */}
        <div className="flex justify-center">
          <div className="rounded-full bg-secondary p-4">
            <Camera className="h-12 w-12 text-foreground" />
          </div>
        </div>

        {/* Header */}
        <div className="text-center">
          <h1 className="text-3xl font-light tracking-wide text-foreground">
            Welcome to StereoView Deluxe
          </h1>
          <p className="mt-2 text-muted-foreground">
            Sign in to manage albums and view photos
          </p>
        </div>

        {/* Login Form */}
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
              className="h-12 bg-secondary text-center text-lg"
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
            Enter
          </Button>
        </form>

        {hasOnlyAdmin && (
          <div className="rounded-lg border border-dashed border-muted-foreground/40 bg-secondary/30 p-4 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">First time here?</p>
            <p>Use admin / admin123 to sign in and add your team.</p>
          </div>
        )}
      </div>
    </div>
  );
}
