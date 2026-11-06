import { describe, expect, it } from 'vitest';
import { needsPreparation } from './usePhotoPreparation';
import type { GalleryPhoto } from '@/services/galleryService';
import type { AlbumRecord } from '@/types/database';

const album = (over: Partial<AlbumRecord> = {}) => ({ id: 'a', source_type: 'upload', import_state: null, ...over }) as AlbumRecord;
const photo = (over: Partial<GalleryPhoto> = {}) =>
  ({ id: 'p', src: 'x', alt: 'x', storagePath: 'o/p.jpg', thumbPath: 'o/p.thumb.webp', ...over }) as GalleryPhoto;

describe('needsPreparation', () => {
  it('is false for a photo with a thumbnail', () => {
    expect(needsPreparation(photo(), album())).toBe(false);
  });

  it('is true without a thumbnail', () => {
    expect(needsPreparation(photo({ thumbPath: undefined }), album())).toBe(true);
  });

  it('skips live Dropbox albums, which have no stored original', () => {
    expect(needsPreparation(photo({ thumbPath: undefined }), album({ source_type: 'dropbox', import_state: 'live' }))).toBe(false);
    expect(needsPreparation(photo({ thumbPath: undefined }), album({ source_type: 'dropbox', import_state: 'imported' }))).toBe(true);
  });
});
