import { describe, expect, it } from 'vitest';
import { photoCountLabel } from './photoCount';

describe('photoCountLabel', () => {
  it('shows no number while the folder is still being listed', () => {
    expect(photoCountLabel({ total: 0, status: 'loading' })).toEqual({ count: 'Counting photos…', progress: null });
  });

  it('keeps the final total apart from previews still arriving', () => {
    expect(photoCountLabel({ total: 57, previewsSettled: 12 })).toEqual({ count: '57 photos', progress: 'previews 12 of 57' });
  });

  it('drops the progress once every preview is in', () => {
    expect(photoCountLabel({ total: 1, previewsSettled: 1 })).toEqual({ count: '1 photo', progress: null });
  });

  it('counts stored photos directly', () => {
    expect(photoCountLabel({ total: 9 })).toEqual({ count: '9 photos', progress: null });
  });

  it('says so when the listing failed, instead of "0 photos"', () => {
    expect(photoCountLabel({ total: 0, status: 'error' }).count).toBe('Photos could not be listed');
  });
});
