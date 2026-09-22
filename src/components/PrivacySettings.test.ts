import { describe, expect, it } from 'vitest';
import { isPrivacyValid } from './PrivacySettings';

describe('isPrivacyValid', () => {
  it('public is always saveable, PIN or not', () => {
    expect(isPrivacyValid({ isPublic: true, passwordSet: false, pendingChange: null })).toBe(true);
    expect(isPrivacyValid({ isPublic: true, passwordSet: false, pendingChange: 'clear' })).toBe(true);
  });

  it('private needs a PIN already stored or one staged', () => {
    expect(isPrivacyValid({ isPublic: false, passwordSet: false, pendingChange: null })).toBe(false);
    expect(isPrivacyValid({ isPublic: false, passwordSet: true, pendingChange: null })).toBe(true);
    expect(isPrivacyValid({ isPublic: false, passwordSet: false, pendingChange: 'set' })).toBe(true);
  });

  it('removing the PIN while private is not saveable', () => {
    expect(isPrivacyValid({ isPublic: false, passwordSet: true, pendingChange: 'clear' })).toBe(false);
  });
});
