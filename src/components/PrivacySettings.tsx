import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface PrivacySettingsProps {
  isPublic: boolean;
  onIsPublicChange: (value: boolean) => void;
  passwordSet: boolean; // Indicates if a password already exists in the DB
  onPasswordChange: (password: string | null) => void;
}

export const PrivacySettings: React.FC<PrivacySettingsProps> = ({
  isPublic,
  onIsPublicChange,
  passwordSet,
  onPasswordChange,
}) => {
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handlePasswordClear = () => {
    setPasswordInput('');
    onPasswordChange(null); // Passing null tells the service layer to clear it
  };

  const handlePasswordApply = () => {
    if (passwordInput.trim()) {
      onPasswordChange(passwordInput.trim());
    }
  };

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-lg font-medium">Privacy Settings</h3>
      </div>

      {/* Visibility Toggle */}
      <RadioGroup value={isPublic ? 'public' : 'private'} onValueChange={(value) => onIsPublicChange(value === 'public')}>
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
        <div className="flex items-center space-x-2">
          <div className="relative flex-1">
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder={passwordSet ? '•••••••• (Password Configured)' : 'Enter new password'}
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute inset-y-0 right-0 flex items-center pr-3 text-neutral-400 hover:text-neutral-600"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <Button
            type="button"
            onClick={handlePasswordApply}
            disabled={!passwordInput.trim()}
          >
            Apply
          </Button>

          {(passwordSet || passwordInput) && (
            <Button
              type="button"
              onClick={handlePasswordClear}
              variant="destructive"
              outline
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      )}
    </div>
  );
};