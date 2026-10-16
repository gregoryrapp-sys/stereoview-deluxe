import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AlbumUploadDialog, { isAcceptedFile } from './AlbumUploadDialog';

vi.mock('@/services/galleryService', () => ({ uploadSbsPhoto: vi.fn() }));
vi.mock('@/lib/stereoAlign/estimateForImage', () => ({
  applyEstimate: vi.fn(),
  estimateFileAlignment: vi.fn(),
  STORE_MIN_CONFIDENCE: 0.5,
}));
vi.mock('@/lib/spatial/convertSpatial', () => ({ convertSpatialToSbs: vi.fn() }));

describe('isAcceptedFile', () => {
  it('accepts the picker types by extension or MIME, including HEIC with no MIME', () => {
    expect(isAcceptedFile(new File([], 'a.JPG', { type: '' }))).toBe(true);
    expect(isAcceptedFile(new File([], 'b.webp', { type: 'image/webp' }))).toBe(true);
    expect(isAcceptedFile(new File([], 'IMG_1.HEIC', { type: '' }))).toBe(true);
    expect(isAcceptedFile(new File([], 'blob', { type: 'image/heif' }))).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isAcceptedFile(new File([], 'notes.txt', { type: 'text/plain' }))).toBe(false);
    expect(isAcceptedFile(new File([], 'clip.mp4', { type: 'video/mp4' }))).toBe(false);
  });
});

describe('AlbumUploadDialog drag and drop', () => {
  const renderDialog = () =>
    render(
      <AlbumUploadDialog
        open
        onOpenChange={() => {}}
        albumId="album-1"
        albumTitle="Misc"
        eventId="event-1"
        ownerId="owner-1"
        onUploaded={() => {}}
      />,
    );

  const dropFiles = (files: File[]) => {
    const zone = screen.getByText(/drag photos from your computer/i).closest('div[class*="border-dashed"]');
    expect(zone).not.toBeNull();
    fireEvent.drop(zone!, { dataTransfer: { files, types: ['Files'] } });
  };

  it('adds dropped images to the list', () => {
    renderDialog();
    dropFiles([new File(['x'], 'DSC_0001.jpg', { type: 'image/jpeg' }), new File(['x'], 'IMG_2.HEIC', { type: '' })]);
    expect(screen.getByText('DSC_0001.jpg')).toBeInTheDocument();
    expect(screen.getByText('IMG_2.HEIC')).toBeInTheDocument();
    expect(screen.getByText(/2 photos ready/)).toBeInTheDocument();
  });

  it('ignores files that are not images', () => {
    renderDialog();
    dropFiles([new File(['x'], 'notes.txt', { type: 'text/plain' }), new File(['x'], 'ok.png', { type: 'image/png' })]);
    expect(screen.queryByText('notes.txt')).toBeNull();
    expect(screen.getByText('ok.png')).toBeInTheDocument();
  });
});
