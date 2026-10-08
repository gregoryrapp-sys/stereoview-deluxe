import { describe, expect, it } from 'vitest';
import { MAX_EYE_DIMENSION_CAP, MIN_EYE_DIMENSION, maxEyeDimensionFor, photoCacheKey } from '@/lib/imageProcessing';
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

  it('includes the alignment: a nudged or swapped split is a different pair of eyes', () => {
    const subject = photo({ storagePath: 'one.jpg' });
    const identity = photoCacheKey(subject, 'both', { dx: 0, dy: 0, swapped: false });

    expect(photoCacheKey(subject, 'both', { dx: 0, dy: 3, swapped: false })).not.toBe(identity);
    expect(photoCacheKey(subject, 'both', { dx: 0, dy: 0, swapped: true })).not.toBe(identity);
    // No explicit alignment and no stored one resolves to identity.
    expect(photoCacheKey(subject)).toBe(identity);
  });

  it('uses the photo\'s stored alignment when none is passed', () => {
    const swapped = photo({ storagePath: 'one.jpg', alignment: { dx: 2, dy: -1, swapped: true } });
    expect(photoCacheKey(swapped)).toBe(photoCacheKey(swapped, 'both', { dx: 2, dy: -1, swapped: true }));
  });
});

/**
 * The eye size follows the screen. A fixed 1440 made every photo soft on a
 * desktop or retina display: a 3600 px eye became 943x1440 and was stretched
 * back up to fill 2160 device pixels.
 */
describe('maxEyeDimensionFor', () => {
  it('keeps the phone size as the floor', () => {
    expect(maxEyeDimensionFor(852, 3)).toBeGreaterThanOrEqual(MIN_EYE_DIMENSION);
    expect(maxEyeDimensionFor(400, 1)).toBe(MIN_EYE_DIMENSION);
  });

  it('covers a retina laptop in 2D mode with zoom headroom', () => {
    // 1512 CSS px wide at DPR 2 -> 3024 device px, plus 25% headroom.
    expect(maxEyeDimensionFor(1512, 2)).toBe(3780);
  });

  it('caps very large displays so canvas and cache memory stay bounded', () => {
    expect(maxEyeDimensionFor(3840, 2)).toBe(MAX_EYE_DIMENSION_CAP);
  });

  it('tolerates a missing or odd device pixel ratio', () => {
    expect(maxEyeDimensionFor(1920, 0)).toBe(2400);
    expect(maxEyeDimensionFor(1920, 5)).toBe(MAX_EYE_DIMENSION_CAP);
  });
});
