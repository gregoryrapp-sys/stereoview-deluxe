import { describe, expect, it } from 'vitest';
import { needsPreparation } from './usePhotoPreparation';
import { ALIGN_VERSION } from '@/lib/stereoAlign/estimator';
import type { GalleryPhoto } from '@/services/galleryService';
import type { AlbumRecord } from '@/types/database';

const album = (over: Partial<AlbumRecord> = {}) => ({ id: 'a', source_type: 'upload', import_state: null, ...over }) as AlbumRecord;
const photo = (over: Partial<GalleryPhoto> = {}) =>
  ({ id: 'p', src: 'x', alt: 'x', storagePath: 'o/p.jpg', thumbPath: 'o/p.thumb.webp', alignVersion: ALIGN_VERSION, ...over }) as GalleryPhoto;

describe('needsPreparation', () => {
  it('is false for a photo with a thumbnail measured by the current estimator', () => {
    expect(needsPreparation(photo(), album())).toBe(false);
  });

  it('is true without a thumbnail or without any measurement', () => {
    expect(needsPreparation(photo({ thumbPath: undefined }), album())).toBe(true);
    expect(needsPreparation(photo({ alignVersion: null }), album())).toBe(true);
  });

  it('re-measures photos aligned by an older estimator, but leaves manual alignments alone', () => {
    expect(needsPreparation(photo({ alignVersion: ALIGN_VERSION - 1 }), album())).toBe(true);
    expect(needsPreparation(photo({ alignVersion: 0 }), album())).toBe(false);
  });

  it('skips live Dropbox albums, which have no stored original', () => {
    expect(needsPreparation(photo({ thumbPath: undefined }), album({ source_type: 'dropbox', import_state: 'live' }))).toBe(false);
    expect(needsPreparation(photo({ alignVersion: 1 }), album({ source_type: 'dropbox', import_state: 'imported' }))).toBe(true);
  });
});
