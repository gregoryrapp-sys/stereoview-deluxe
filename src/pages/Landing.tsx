import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Camera } from 'lucide-react';

export default function Landing() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (login(password)) {
      navigate('/gallery');
    } else {
      setError('Incorrect password');
      setPassword('');
    }
  };

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
            Welcome to Greg's Photos
          </h1>
          <p className="mt-2 text-muted-foreground">
            Enter password to continue
          </p>
        </div>

        {/* Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 bg-secondary text-center text-lg tracking-widest"
              autoFocus
            />
            {error && (
              <p className="text-center text-sm text-destructive">{error}</p>
            )}
          </div>

          <Button
            type="submit"
            className="h-12 w-full text-lg"
            disabled={!password}
          >
            Enter
          </Button>
        </form>
      </div>
    </div>
  );
}
