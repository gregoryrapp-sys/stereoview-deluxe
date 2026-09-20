import { describe, expect, it } from 'vitest';
import { deriveThumbPath, photoObjectPath } from './photoPaths';

describe('photoObjectPath', () => {
  it('keeps the owner uid as the first segment (storage RLS depends on it)', () => {
    const path = photoObjectPath('owner', 'event', 'album', 'photo');
    expect(path.split('/')[0]).toBe('owner');
    expect(path).toBe('owner/events/event/albums/album/photos/photo/stereo.jpg');
  });

  it('honours the extension', () => {
    expect(photoObjectPath('o', 'e', 'a', 'p', 'png')).toMatch(/stereo\.png$/);
  });
});

describe('deriveThumbPath', () => {
  it('replaces the extension with .thumb.<ext>', () => {
    expect(deriveThumbPath('o/events/e/albums/a/photos/p/stereo.jpg', 'webp')).toBe(
      'o/events/e/albums/a/photos/p/stereo.thumb.webp',
    );
  });

  it('works for legacy admin paths with timestamps and dots in the name', () => {
    expect(deriveThumbPath('o/a/1700000000000-DSC_0001.final.JPG', 'jpg')).toBe(
      'o/a/1700000000000-DSC_0001.final.thumb.jpg',
    );
  });

  it('does not treat a dot inside a folder as an extension', () => {
    expect(deriveThumbPath('o.wner/a/noext', 'webp')).toBe('o.wner/a/noext.thumb.webp');
  });
});
