import { describe, expect, it } from 'vitest';
import { albumCountsByFile, unusedObjects } from './photoFiles';

const a = { storage_path: 'u/1.jpg', thumb_path: 'u/1.thumb.webp' };
const b = { storage_path: 'u/2.jpg', thumb_path: null };

describe('unusedObjects', () => {
  it('removes the original and thumbnail of a file nothing else uses', () => {
    expect(unusedObjects([a], new Map())).toEqual(['u/1.jpg', 'u/1.thumb.webp']);
  });

  it('keeps a file another album still shows', () => {
    expect(unusedObjects([a, b], new Map([['u/1.jpg', 1]]))).toEqual(['u/2.jpg']);
  });

  it('lists a file once when two deleted rows shared it', () => {
    expect(unusedObjects([a, { ...a }], new Map())).toEqual(['u/1.jpg', 'u/1.thumb.webp']);
  });
});

describe('albumCountsByFile', () => {
  it('counts rows per file and ignores photos without one', () => {
    const counts = albumCountsByFile([{ storagePath: 'x' }, { storagePath: 'x' }, { storagePath: 'y' }, {}]);
    expect(counts.get('x')).toBe(2);
    expect(counts.get('y')).toBe(1);
  });
});
