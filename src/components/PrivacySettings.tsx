import React, { useState } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import ShareLinkField from '@/components/ShareLinkField';

export type PrivacyLevel = 'profile' | 'event' | 'album';

export type PendingPinChange = 'set' | 'clear' | null;

/**
 * Accessibility settings for a profile, event or album.
 *
 * Two independent choices, in the photographer's own vocabulary:
 *
 *   Where it appears   Public  = listed (Photographers page / event list / album list)
 *                      Private = reachable only by link or QR code          -> is_listed
 *   Require a PIN      off = anyone who reaches it can view
 *                      on  = a 4-6 digit PIN is asked for                  -> !is_public
 *
 * That gives the four combinations they described: public/private x PIN/no PIN.
 * The column names predate the wording (is_public means "no PIN"); nothing in
 * the data model changed for this.
 */
interface PrivacySettingsProps {
  level: PrivacyLevel;
  /** DB `is_public`: true = no PIN; false = PIN required. */
  isPublic: boolean;
  onIsPublicChange: (value: boolean) => void;
  /** DB `is_listed`: true = shown in lists ("Public"); false = link-only ("Private"). */
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
 * Whether the settings can be saved.
 *
 * "Require a PIN" without a PIN is a dead end - there is nothing to unlock -
 * so the database refuses it (`*_private_requires_pin`) and the Save buttons
 * should too, with the reason shown next to the field.
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

const PUBLIC_COPY: Record<PrivacyLevel, string> = {
  profile: 'Public - shown on the Photographers page',
  event: "Public - shown in your photographer page's event list",
  album: "Public - shown in the event's album list",
};

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

  const requirePin = !isPublic;

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
      <h3 className="text-lg font-medium">Accessibility</h3>

      {/* Where it appears */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Where it appears</Label>
        <RadioGroup
          value={isListed ? 'public' : 'private'}
          onValueChange={(value) => onIsListedChange(value === 'public')}
        >
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="public" id={`${level}-appears-public`} />
            <Label htmlFor={`${level}-appears-public`} className="font-normal">
              {PUBLIC_COPY[level]}
            </Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="private" id={`${level}-appears-private`} />
            <Label htmlFor={`${level}-appears-private`} className="font-normal">
              Private - only people with the link or QR code
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* PIN */}
      <div className="space-y-3">
        <div className="flex items-center space-x-2">
          <Checkbox
            id={`${level}-require-pin`}
            checked={requirePin}
            onCheckedChange={(checked) => {
              const next = checked === true;
              onIsPublicChange(!next);
              // Turning the PIN off clears a stored PIN. Rows without a PIN
              // requirement are readable through PostgREST, and a bcrypt hash
              // on such a row would be world-readable while protecting nothing.
              if (!next && passwordSet) {
                setPasswordInput('');
                onPasswordChange(null);
              }
            }}
          />
          <Label htmlFor={`${level}-require-pin`} className="text-sm font-medium">
            Require a PIN to view
          </Label>
        </div>

        {requirePin && (
          <div className="space-y-3 rounded-md bg-secondary/40 p-3">
            <div className="flex items-center space-x-2">
              {/* Shown in clear: only the owner ever types here. */}
              <Input
                className="flex-1 font-mono tracking-widest"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="off"
                placeholder={passwordSet ? 'PIN set - enter a new one to change it' : '4-6 digits, e.g. 2468'}
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
                Set a PIN, or turn the PIN off, before saving.
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

      {shareUrl && (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Link</Label>
          <ShareLinkField url={shareUrl} emphasize={!isListed} stale={shareUrlStale} />
        </div>
      )}
    </div>
  );
};
