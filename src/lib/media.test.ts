import { describe, expect, it } from 'vitest';
import { formatDuration, isVideoFile, isVideoPath, isVideoPhoto, videoContentType } from './media';

describe('isVideoPath', () => {
  it('recognises video extensions, ignoring case and query strings', () => {
    expect(isVideoPath('u/e/a/photos/1.mp4')).toBe(true);
    expect(isVideoPath('https://x.supabase.co/storage/v1/object/sign/photos/u/1.MOV?token=abc')).toBe(true);
    expect(isVideoPath('u/e/a/photos/1.jpg')).toBe(false);
    expect(isVideoPath('u/1.mp4.jpg')).toBe(false);
    expect(isVideoPath(null)).toBe(false);
  });
});

describe('isVideoFile', () => {
  it('accepts by extension or MIME type', () => {
    expect(isVideoFile({ name: 'output_FSBS.mp4', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'clip', type: 'video/quicktime' })).toBe(true);
    expect(isVideoFile({ name: 'a.jpg', type: 'image/jpeg' })).toBe(false);
  });
});

describe('isVideoPhoto', () => {
  it('prefers the storage path and falls back to the URL', () => {
    expect(isVideoPhoto({ storagePath: 'u/1.mp4', src: 'https://x/sign?token=1' })).toBe(true);
    expect(isVideoPhoto({ src: 'https://x/u/1.m4v?token=1' })).toBe(true);
    expect(isVideoPhoto({ storagePath: 'u/1.jpg', src: 'https://x/u/1.jpg' })).toBe(false);
  });
});

describe('videoContentType', () => {
  it('keeps a real video MIME type, otherwise derives one from the extension', () => {
    expect(videoContentType({ name: 'a.mp4', type: 'video/mp4' })).toBe('video/mp4');
    expect(videoContentType({ name: 'a.MOV', type: '' })).toBe('video/quicktime');
    expect(videoContentType({ name: 'a.mp4', type: '' })).toBe('video/mp4');
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(68.9)).toBe('1:08');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(NaN)).toBe('0:00');
  });
});
