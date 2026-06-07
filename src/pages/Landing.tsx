import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Camera } from 'lucide-react';

export default function Landing() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { login, isAuthenticated, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      navigate('/gallery');
    }
  }, [isAuthenticated, isLoading, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    const result = await login(email, password);
    setIsSubmitting(false);

    if (!result.error) {
      navigate('/gallery');
    } else {
      setError(result.error);
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
            Sign in to continue
          </p>
        </div>

        {/* Password Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 bg-secondary text-base"
              autoComplete="email"
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 bg-secondary text-base"
              autoComplete="current-password"
            />
            {error && (
              <p className="text-center text-sm text-destructive">{error}</p>
            )}
          </div>

          <Button
            type="submit"
            className="h-12 w-full text-lg"
            disabled={!email || !password || isSubmitting}
          >
            {isSubmitting ? 'Signing in...' : 'Enter'}
          </Button>
        </form>
      </div>
    </div>
  );
}
