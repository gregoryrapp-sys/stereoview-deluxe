import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePhotoPreparation } from './usePhotoPreparation';
import { ALIGN_VERSION } from '@/lib/stereoAlign/estimator';
import type { GalleryPhoto } from '@/services/galleryService';
import type { AlbumRecord } from '@/types/database';

const finish = vi.fn(async () => {});
const estimate = vi.fn();
vi.mock('@/services/galleryService', () => ({
  finishPhotoPreparation: (...a: unknown[]) => finish(...(a as [])),
  signedOriginalUrl: async (path: string) => `https://example.test/${path}`,
  uploadThumbnail: async () => 'thumb.webp',
}));
vi.mock('@/lib/makeThumbnail', () => ({ makeSbsThumbnail: async () => ({ blob: new Blob(['t']), extension: 'webp', width: 1, height: 1 }) }));
vi.mock('@/lib/stereoAlign/estimateForImage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/stereoAlign/estimateForImage')>('@/lib/stereoAlign/estimateForImage');
  return { ...actual, estimateFileAlignment: (...a: unknown[]) => estimate(...a) };
});

const album = { id: 'a', source_type: 'upload', import_state: null, lr_swapped_default: false } as unknown as AlbumRecord;
const photo = (id: string, over: Partial<GalleryPhoto> = {}) =>
  ({ id, src: 'x', alt: id, albumId: 'a', storagePath: `p/${id}.jpg`, thumbPath: `p/${id}.thumb.webp`, alignVersion: ALIGN_VERSION, alignment: { dx: 0, dy: 0, swapped: false }, ...over }) as GalleryPhoto;
const est = (confidence: number) => ({
  alignment: { dx: 4, dy: -2, swapped: false, rotation: 0.3 }, confidence, swapSuggested: false, swapConfidence: 0,
  rotationSuspected: true, disparity: { p05: 0, median: 0, p95: 0 }, windowDx: 4, inliers: 50, version: ALIGN_VERSION,
});

describe('usePhotoPreparation run', () => {
  let fetches = 0;
  beforeEach(() => {
    fetches = 0;
    finish.mockClear();
    estimate.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => { fetches++; return new Response(new Blob(['jpg'])); }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('actually re-measures photos aligned by an older estimator, downloading each once', async () => {
    estimate.mockResolvedValue(est(0.8));
    const photos = [photo('old1', { alignVersion: 1 }), photo('old2', { alignVersion: 1 }), photo('current'), photo('manual', { alignVersion: 0 })];
    const onPrepared = vi.fn();
    const { result } = renderHook(() => usePhotoPreparation(photos, [album], { enabled: true, onPrepared }));
    await waitFor(() => expect(result.current.done).toBe(2));
    expect(fetches).toBe(2);
    expect(estimate).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ photoId: 'old1', version: ALIGN_VERSION, alignment: expect.objectContaining({ rotation: 0.3 }) }));
    expect(onPrepared).toHaveBeenCalledTimes(2);
  });

  it('keeps the existing alignment when a re-measure is unsure', async () => {
    estimate.mockResolvedValue(est(0.2));
    const kept = { dx: 9, dy: 3, swapped: true };
    const photos = [photo('old', { alignVersion: 1, alignment: kept })];
    renderHook(() => usePhotoPreparation(photos, [album], { enabled: true, onPrepared: () => {} }));
    await waitFor(() => expect(finish).toHaveBeenCalledTimes(1));
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ alignment: kept, version: ALIGN_VERSION }));
  });

  it('does nothing at all when every photo is current', async () => {
    const photos = [photo('a1'), photo('a2'), photo('m', { alignVersion: 0 })];
    renderHook(() => usePhotoPreparation(photos, [album], { enabled: true, onPrepared: () => {} }));
    await new Promise((r) => setTimeout(r, 50));
    expect(fetches).toBe(0);
  });
});
