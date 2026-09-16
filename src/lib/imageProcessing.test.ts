import { describe, expect, it } from 'vitest';
import { photoCacheKey } from '@/lib/imageProcessing';
import type { DropboxFile, GalleryPhoto } from '@/services/galleryService';

/**
 * The cache key is the whole caching fix. Supabase photo URLs are signed and
 * regenerated on every gallery fetch, so a key derived from `src` changed on
 * every reload and guaranteed a 100% miss - in this cache and in the browser's.
 */
describe('photoCacheKey', () => {
  const photo = (over: Partial<GalleryPhoto>): GalleryPhoto =>
    ({ id: 'photo-1', src: 'https://example.test/a.jpg', alt: 'a.jpg', ...over }) as GalleryPhoto;

  it('is stable when only the signed URL changes', () => {
    const first = photo({ storagePath: 'owner/events/e/albums/a/photos/p/stereo.jpg', src: '...?token=AAA' });
    const second = photo({ storagePath: 'owner/events/e/albums/a/photos/p/stereo.jpg', src: '...?token=BBB' });

    expect(photoCacheKey(first)).toBe(photoCacheKey(second));
  });

  it('prefers storagePath over the row id', () => {
    const withPath = photo({ storagePath: 'stable/path.jpg', id: 'photo-1' });
    const withoutPath = photo({ id: 'photo-1' });

    expect(photoCacheKey(withPath)).toContain('stable/path.jpg');
    expect(photoCacheKey(withPath)).not.toBe(photoCacheKey(withoutPath));
  });

  it('distinguishes different photos', () => {
    expect(photoCacheKey(photo({ storagePath: 'one.jpg' })))
      .not.toBe(photoCacheKey(photo({ storagePath: 'two.jpg' })));
  });

  it('separates a left-only result from a both-eyes result', () => {
    const subject = photo({ storagePath: 'one.jpg' });

    // A left-only entry cannot satisfy a stereo request, so they must not collide.
    expect(photoCacheKey(subject, 'left')).not.toBe(photoCacheKey(subject, 'both'));
  });

  it('keys a Dropbox file on its stable id, not its expiring share URL', () => {
    const base = { name: 'a.jpg', path_lower: '/a.jpg', id: 'id:abc123' };
    const first = { ...base, src: 'https://dropbox.test/a.jpg?rlkey=OLD' } as DropboxFile;
    const second = { ...base, src: 'https://dropbox.test/a.jpg?rlkey=NEW' } as DropboxFile;

    expect(photoCacheKey(first)).toBe(photoCacheKey(second));
    expect(photoCacheKey(first)).toContain('id:abc123');
  });

  it('falls back to src when no stable identity exists', () => {
    const bare = { src: 'https://example.test/only.jpg' } as GalleryPhoto;

    expect(photoCacheKey(bare)).toContain('https://example.test/only.jpg');
  });
});
