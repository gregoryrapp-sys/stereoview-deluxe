import { describe, expect, it } from 'vitest';
import { singleAlbumOf } from './singleAlbum';

const album = (event_id: string, slug: string) => ({ event_id, slug });

describe('singleAlbumOf', () => {
  it('finds the only album of an event', () => {
    const albums = [album('e1', 'a'), album('e2', 'b'), album('e2', 'c')];
    expect(singleAlbumOf('e1', albums)?.slug).toBe('a');
  });

  it('is null when the event has several albums or none', () => {
    const albums = [album('e1', 'a'), album('e2', 'b'), album('e2', 'c')];
    expect(singleAlbumOf('e2', albums)).toBeNull();
    expect(singleAlbumOf('e3', albums)).toBeNull();
  });
});
