import { describe, expect, it } from 'vitest';
import { isUnnamedNewAlbum, NEW_ALBUM_TITLE } from './newAlbum';

describe('isUnnamedNewAlbum', () => {
  it('recognises the row Add Album creates', () => {
    expect(isUnnamedNewAlbum({ title: NEW_ALBUM_TITLE, slug: 'new-album-96cc254a' })).toBe(true);
  });

  it('is false once the album has a name or a chosen slug', () => {
    expect(isUnnamedNewAlbum({ title: 'Brunch', slug: 'new-album-96cc254a' })).toBe(false);
    expect(isUnnamedNewAlbum({ title: NEW_ALBUM_TITLE, slug: 'new-album' })).toBe(false);
    expect(isUnnamedNewAlbum({ title: NEW_ALBUM_TITLE, slug: 'new-album-brunch' })).toBe(false);
  });
});
