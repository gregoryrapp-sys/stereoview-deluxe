import { useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { type AccessLevel, unlockWithPin } from '@/lib/accessGrant';

/**
 * PIN prompt for a private profile, event or album.
 *
 * Nothing like this existed. PrivacySettings could *set* a PIN from the owner's
 * management page, but there was no way to enter one anywhere, and the RLS check
 * reads a JWT claim nothing minted - so setting a PIN made content permanently
 * unreachable rather than protected.
 */

const LABELS: Record<AccessLevel, string> = {
  profile: 'This photographer page is private',
  event: 'This event is private',
  album: 'This album is private',
};

interface PinGateProps {
  level: AccessLevel;
  objectId: string;
  onUnlocked: () => void;
}

export default function PinGate({ level, objectId, onUnlocked }: PinGateProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = /^[0-9]{4,6}$/.test(pin);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isValid || isSubmitting) return;

    setIsSubmitting(true);
    setError('');
    try {
      await unlockWithPin({ objectType: level, objectId, pin });
      onUnlocked();
    } catch {
      // The function returns the same response for a wrong PIN and a missing
      // row, so there is nothing more specific to say here.
      setError('Incorrect PIN. Please try again.');
      setPin('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <KeyRound className="h-5 w-5" />
          </div>
          <CardTitle>{LABELS[level]}</CardTitle>
          <CardDescription>
            Enter the PIN you were given to view these photos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="access-pin">PIN</Label>
              <Input
                id="access-pin"
                value={pin}
                onChange={(event) => {
                  setPin(event.target.value.replace(/[^0-9]/g, '').slice(0, 6));
                  setError('');
                }}
                inputMode="numeric"
                autoComplete="off"
                placeholder="4-6 digits"
                autoFocus
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <Button type="submit" className="w-full gap-2" disabled={!isValid || isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSubmitting ? 'Checking...' : 'Unlock'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
