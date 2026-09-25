import { describe, expect, it } from 'vitest';
import { findStereoGroup, isHeifBytes, isHeifFile } from './heifBoxes';
import { box, concat, ftyp, fullBoxHeader, plainSkeleton, spatialSkeleton, ster } from './heifBoxes.testutil';

describe('isHeifFile', () => {
  it('accepts by extension or MIME type, case-insensitively', () => {
    expect(isHeifFile({ name: 'IMG_0001.HEIC', type: '' })).toBe(true);
    expect(isHeifFile({ name: 'photo.heif', type: 'image/heif' })).toBe(true);
    expect(isHeifFile({ name: 'blob', type: 'image/heic' })).toBe(true);
    expect(isHeifFile({ name: 'photo.jpg', type: 'image/jpeg' })).toBe(false);
  });
});

describe('isHeifBytes', () => {
  it('needs an ftyp header', () => {
    expect(isHeifBytes(spatialSkeleton(1, 2))).toBe(true);
    expect(isHeifBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(isHeifBytes(new Uint8Array(4))).toBe(false);
  });
});

describe('findStereoGroup', () => {
  it('returns the ster group ids in order, left first', () => {
    expect(findStereoGroup(spatialSkeleton(26, 52))).toEqual([26, 52]);
    expect(findStereoGroup(spatialSkeleton(52, 26))).toEqual([52, 26]);
  });

  it('returns null for a HEIC without a stereo group', () => {
    expect(findStereoGroup(plainSkeleton())).toBeNull();
  });

  it('ignores a ster box that is not inside grpl', () => {
    const stray = concat(ftyp(), box('meta', fullBoxHeader, ster(3, [1, 2])));
    expect(findStereoGroup(stray)).toBeNull();
  });

  it('survives truncated or garbage input', () => {
    expect(findStereoGroup(spatialSkeleton(1, 2).subarray(0, 30))).toBeNull();
    expect(findStereoGroup(new Uint8Array([0, 0, 0, 200, 109, 101, 116, 97]))).toBeNull();
  });
});
