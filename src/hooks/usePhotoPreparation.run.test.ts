import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePhotoPreparation } from './usePhotoPreparation';
import type { GalleryPhoto } from '@/services/galleryService';
import type { AlbumRecord } from '@/types/database';

const finish = vi.fn(async () => {});
vi.mock('@/services/galleryService', () => ({
  finishPhotoPreparation: (...a: unknown[]) => finish(...(a as [])),
  signedOriginalUrl: async (path: string) => `https://example.test/${path}`,
  uploadThumbnail: async () => 'thumb.webp',
}));
vi.mock('@/lib/makeThumbnail', () => ({ makeSbsThumbnail: async () => ({ blob: new Blob(['t']), extension: 'webp', width: 1, height: 1 }) }));

const album = { id: 'a', source_type: 'upload', import_state: null, lr_swapped_default: false } as unknown as AlbumRecord;
const photo = (id: string, over: Partial<GalleryPhoto> = {}) =>
  ({ id, src: 'x', alt: id, albumId: 'a', storagePath: `p/${id}.jpg`, thumbPath: `p/${id}.thumb.webp`, ...over }) as GalleryPhoto;

describe('usePhotoPreparation run', () => {
  let fetches = 0;
  beforeEach(() => {
    fetches = 0;
    finish.mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => { fetches++; return new Response(new Blob(['jpg'])); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('makes the missing thumbnails, downloading each original once', async () => {
    const photos = [photo('t1', { thumbPath: undefined }), photo('t2', { thumbPath: undefined }), photo('has-thumb')];
    const onPrepared = vi.fn();
    const { result } = renderHook(() => usePhotoPreparation(photos, [album], { enabled: true, onPrepared }));
    await waitFor(() => expect(result.current.done).toBe(2));
    expect(fetches).toBe(2);
    expect(finish).toHaveBeenCalledWith({ photoId: 't1', thumbPath: 'thumb.webp' });
    expect(onPrepared).toHaveBeenCalledWith('t2', { thumbPath: 'thumb.webp' });
  });

  it('does nothing at all when every photo has a thumbnail', async () => {
    const photos = [photo('a1'), photo('a2')];
    renderHook(() => usePhotoPreparation(photos, [album], { enabled: true, onPrepared: () => {} }));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetches).toBe(0);
  });
});
