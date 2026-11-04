import { describe, expect, it } from 'vitest';
import { albumHasUnsavedChanges, eventHasUnsavedChanges, profileHasUnsavedChanges } from './unsavedChanges';

const savedAlbum = { title: 'Tift Merritt', description: null, slug: 'tift-merritt', cover_photo_id: null, dropbox_cover_image_name: null, dropbox_folder_url: null, is_public: true, is_listed: true, lr_swapped_default: false };
const albumForm = { title: 'Tift Merritt', description: '', slug: 'tift-merritt', coverPhotoId: null, dropboxCoverImageName: null, dropboxUrl: '', isPublic: true, isListed: true, lrSwappedDefault: false, passwordDirty: false };

describe('albumHasUnsavedChanges', () => {
  it('a freshly loaded form, with database nulls, is not dirty', () => {
    expect(albumHasUnsavedChanges(albumForm, savedAlbum)).toBe(false);
  });
  it('every Save field counts', () => {
    expect(albumHasUnsavedChanges({ ...albumForm, title: 'Tift' }, savedAlbum)).toBe(true);
    expect(albumHasUnsavedChanges({ ...albumForm, description: 'x' }, savedAlbum)).toBe(true);
    expect(albumHasUnsavedChanges({ ...albumForm, isListed: false }, savedAlbum)).toBe(true);
    expect(albumHasUnsavedChanges({ ...albumForm, lrSwappedDefault: true }, savedAlbum)).toBe(true);
    expect(albumHasUnsavedChanges({ ...albumForm, coverPhotoId: 'p1' }, savedAlbum)).toBe(true);
    expect(albumHasUnsavedChanges({ ...albumForm, passwordDirty: true }, savedAlbum)).toBe(true);
  });
});

describe('eventHasUnsavedChanges', () => {
  const saved = { title: 'HSB 2026', description: 'x', slug: 'hsb', cover_photo_id: 'c', dropbox_cover_album_id: null, dropbox_cover_image_name: null, is_public: false, is_listed: true };
  const form = { title: 'HSB 2026', description: 'x', slug: 'hsb', coverPhotoId: 'c', dropboxCoverAlbumId: null, dropboxCoverImageName: null, isPublic: false, isListed: true, passwordDirty: false };
  it('clean when equal, dirty on a change', () => {
    expect(eventHasUnsavedChanges(form, saved)).toBe(false);
    expect(eventHasUnsavedChanges({ ...form, slug: 'hsb-2026' }, saved)).toBe(true);
    expect(eventHasUnsavedChanges({ ...form, isPublic: true }, saved)).toBe(true);
  });
});

describe('profileHasUnsavedChanges', () => {
  const saved = { display_name: null, slug: 'gregoryrapp', is_public: true, is_listed: true };
  const form = { displayName: '', slug: 'gregoryrapp', coverPhotoId: null, dropboxCoverAlbumId: null, dropboxCoverImageName: null, isPublic: true, isListed: true, passwordDirty: false };
  it('treats missing database fields like the form does', () => {
    expect(profileHasUnsavedChanges(form, saved)).toBe(false);
    expect(profileHasUnsavedChanges({ ...form, displayName: 'Gregory Rapp' }, saved)).toBe(true);
  });
});
