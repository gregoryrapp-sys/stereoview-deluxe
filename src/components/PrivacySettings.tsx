import React, { useState } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import ShareLinkField from '@/components/ShareLinkField';

export type PrivacyLevel = 'profile' | 'event' | 'album';

export type PendingPinChange = 'set' | 'clear' | null;

interface PrivacySettingsProps {
  level: PrivacyLevel;
  /** Access: true = anyone with the link can view; false = a PIN is required. */
  isPublic: boolean;
  onIsPublicChange: (value: boolean) => void;
  /** Listing: true = shown in lists; false = reachable only by direct link. */
  isListed: boolean;
  onIsListedChange: (value: boolean) => void;
  passwordSet: boolean; // Indicates if a password already exists in the DB
  onPasswordChange: (password: string | null) => void;
  /**
   * Whether the owner has staged a PIN change that has not been saved yet.
   *
   * "Set PIN" only writes to the parent's React state - nothing reaches the
   * database until the object's own Save button is pressed. Without a visible
   * signal that reads as unfinished, the button looks like it committed, and
   * the PIN is lost on navigation with no warning.
   */
  pendingChange?: PendingPinChange;
  /** The saved public URL, for Copy / QR code. */
  shareUrl?: string;
  /** The slug in the form differs from the saved one. */
  shareUrlStale?: boolean;
}

/**
 * Whether the access settings can be saved.
 *
 * Private without a PIN is a dead end - there is nothing to unlock - so the
 * database refuses it (`*_private_requires_pin`) and the Save buttons should
 * too, with a reason shown next to the field rather than an error after the
 * fact.
 */
export function isPrivacyValid({
  isPublic,
  passwordSet,
  pendingChange,
}: {
  isPublic: boolean;
  passwordSet: boolean;
  pendingChange: PendingPinChange;
}): boolean {
  if (isPublic) return true;
  if (pendingChange === 'set') return true;
  if (pendingChange === 'clear') return false;
  return passwordSet;
}

const NOUN: Record<PrivacyLevel, string> = {
  profile: 'photographer page',
  event: 'event',
  album: 'album',
};

const LISTED_COPY: Record<PrivacyLevel, string> = {
  profile: 'Listed - shown on the Photographers page',
  event: 'Listed - shown on your photographer page',
  album: 'Listed - shown in the event',
};

function summarize(isPublic: boolean, isListed: boolean): string {
  if (isPublic && isListed) return 'Shown in listings; anyone with the link can view.';
  if (isPublic) return 'Not shown in listings; anyone with the link can view.';
  if (isListed) return 'Shown in listings with a lock; a PIN is needed to open it.';
  return 'Not shown in listings; needs both the link and the PIN.';
}

export const PrivacySettings: React.FC<PrivacySettingsProps> = ({
  level,
  isPublic,
  onIsPublicChange,
  isListed,
  onIsListedChange,
  passwordSet,
  onPasswordChange,
  pendingChange = null,
  shareUrl,
  shareUrlStale = false,
}) => {
  const [passwordInput, setPasswordInput] = useState('');

  const handlePasswordClear = () => {
    setPasswordInput('');
    onPasswordChange(null); // Passing null tells the service layer to clear it
  };

  const isValidPin = /^[0-9]{4,6}$/.test(passwordInput.trim());

  const handlePasswordApply = () => {
    const trimmed = passwordInput.trim();
    if (/^[0-9]{4,6}$/.test(trimmed)) {
      onPasswordChange(trimmed);
      setPasswordInput('');
    }
  };

  const pinMissing = !isPrivacyValid({ isPublic, passwordSet, pendingChange });

  return (
    <div className="space-y-5 rounded-lg border p-4">
      <div>
        <h3 className="text-lg font-medium">Access &amp; visibility</h3>
        <p className="text-xs text-muted-foreground">{summarize(isPublic, isListed)}</p>
      </div>

      {/* Access */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Who can view</Label>
        <RadioGroup
          value={isPublic ? 'public' : 'private'}
          onValueChange={(value) => {
            const nextIsPublic = value === 'public';
            onIsPublicChange(nextIsPublic);
            // Clear the PIN on the way back to public. RLS short-circuits on
            // is_public, so a PIN left on a public row protects nothing while its
            // bcrypt hash becomes world-readable along with the rest of the row -
            // and the field is hidden in this state, so it could never be cleared
            // by hand.
            if (nextIsPublic && passwordSet) {
              setPasswordInput('');
              onPasswordChange(null);
            }
          }}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="public" id={`${level}-access-public`} />
            <Label htmlFor={`${level}-access-public`} className="font-normal">
              Public - anyone with the link can view
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="private" id={`${level}-access-private`} />
            <Label htmlFor={`${level}-access-private`} className="font-normal">
              Private - a PIN is required to view
            </Label>
          </div>
        </RadioGroup>

        {!isPublic && (
          <div className="space-y-3 rounded-md bg-secondary/40 p-3">
            <p className="text-xs text-muted-foreground">
              4-6 digits. Only you see this field; share the PIN with your guests.
            </p>
            <div className="flex items-center space-x-2">
              {/* Shown in clear: only the owner ever types here, and a masked
                  4-6 digit field made people unsure what they had entered. */}
              <Input
                className="flex-1 font-mono tracking-widest"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="off"
                placeholder={passwordSet ? 'PIN set - enter a new one to change it' : 'e.g. 2468'}
                value={passwordInput}
                onChange={(e) => {
                  const digits = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
                  setPasswordInput(digits);
                }}
              />

              <Button type="button" onClick={handlePasswordApply} disabled={!isValidPin}>
                {passwordSet ? 'Change PIN' : 'Set PIN'}
              </Button>

              {(passwordSet || passwordInput) && (
                <Button type="button" onClick={handlePasswordClear} variant="outline">
                  Remove
                </Button>
              )}
            </div>
            {passwordInput && !isValidPin && (
              <p className="text-xs text-destructive">PIN must be 4-6 digits.</p>
            )}
            {pinMissing && (
              <p className="text-xs font-medium text-destructive">
                A private {NOUN[level]} needs a PIN before it can be saved.
              </p>
            )}
            {pendingChange && (
              <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-600 dark:text-amber-400">
                {pendingChange === 'set'
                  ? 'PIN entered but NOT saved yet - press Save below to apply it.'
                  : 'PIN will be removed when you press Save below.'}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Listing */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Where it appears</Label>
        <RadioGroup
          value={isListed ? 'listed' : 'unlisted'}
          onValueChange={(value) => onIsListedChange(value === 'listed')}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="listed" id={`${level}-listing-listed`} />
            <Label htmlFor={`${level}-listing-listed`} className="font-normal">
              {LISTED_COPY[level]}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="unlisted" id={`${level}-listing-unlisted`} />
            <Label htmlFor={`${level}-listing-unlisted`} className="font-normal">
              Unlisted - reachable only by link or QR code
            </Label>
          </div>
        </RadioGroup>
        {!isListed && (
          <p className="text-xs text-muted-foreground">
            Nothing links here. Copy the link or QR code below to share it. The
            address is not secret - anyone who has it can open the page
            {isPublic ? '.' : ', and will then be asked for the PIN.'}
          </p>
        )}
      </div>

      {shareUrl && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Link</Label>
          <ShareLinkField url={shareUrl} emphasize={!isListed} stale={shareUrlStale} />
        </div>
      )}
    </div>
  );
};
