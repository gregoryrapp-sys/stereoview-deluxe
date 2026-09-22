import React, { useState } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface PrivacySettingsProps {
  isPublic: boolean;
  onIsPublicChange: (value: boolean) => void;
  passwordSet: boolean; // Indicates if a password already exists in the DB
  onPasswordChange: (password: string | null) => void;
  /**
   * Whether the owner has staged a PIN change that has not been saved yet.
   *
   * "Apply" only writes to the parent's React state - nothing reaches the
   * database until the object's own Save button is pressed. Without a visible
   * signal that reads as unfinished, "Apply" looks like it committed, and the
   * PIN is lost on navigation with no warning.
   */
  pendingChange?: 'set' | 'clear' | null;
}

export const PrivacySettings: React.FC<PrivacySettingsProps> = ({
  isPublic,
  onIsPublicChange,
  passwordSet,
  onPasswordChange,
  pendingChange = null,
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

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-lg font-medium">Privacy Settings</h3>
      </div>

      {/* Visibility Toggle */}
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
          <RadioGroupItem value="public" id="privacy-public" />
          <Label htmlFor="privacy-public">Public</Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="private" id="privacy-private" />
          <Label htmlFor="privacy-private">Private (Password Protected)</Label>
        </div>
      </RadioGroup>

      {/* Password Protection */}
      {!isPublic && (
      <div className="space-y-3 pt-2">
        <p className="text-xs text-muted-foreground">PIN must be 4-6 digits. Required for private access.</p>
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

          <Button
            type="button"
            onClick={handlePasswordApply}
            disabled={!isValidPin}
          >
            Set PIN
          </Button>

          {(passwordSet || passwordInput) && (
            <Button
              type="button"
              onClick={handlePasswordClear}
              variant="outline"
            >
              Remove
            </Button>
          )}
        </div>
        {passwordInput && !isValidPin && (
          <p className="text-xs text-destructive">PIN must be 4-6 digits.</p>
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
  );
};