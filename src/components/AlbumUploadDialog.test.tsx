import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import AlbumUploadDialog from './AlbumUploadDialog';
import { isAcceptedFile } from '@/lib/media';

vi.mock('@/services/galleryService', () => ({ uploadSbsPhoto: vi.fn(), uploadSbsVideo: vi.fn() }));
vi.mock('@/lib/spatial/convertSpatial', () => ({ convertSpatialToSbs: vi.fn() }));

describe('isAcceptedFile', () => {
  it('accepts side-by-side videos by extension or MIME', () => {
    expect(isAcceptedFile(new File([], 'output_FSBS.mp4', { type: '' }))).toBe(true);
    expect(isAcceptedFile(new File([], 'clip', { type: 'video/quicktime' }))).toBe(true);
  });

  it('accepts the picker types by extension or MIME, including HEIC with no MIME', () => {
    expect(isAcceptedFile(new File([], 'a.JPG', { type: '' }))).toBe(true);
    expect(isAcceptedFile(new File([], 'b.webp', { type: 'image/webp' }))).toBe(true);
    expect(isAcceptedFile(new File([], 'IMG_1.HEIC', { type: '' }))).toBe(true);
    expect(isAcceptedFile(new File([], 'blob', { type: 'image/heif' }))).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isAcceptedFile(new File([], 'notes.txt', { type: 'text/plain' }))).toBe(false);
    expect(isAcceptedFile(new File([], 'clip.avi', { type: 'video/x-msvideo' }))).toBe(false);
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
    const zone = screen.getByText(/drag photos and videos from your computer/i).closest('div[class*="border-dashed"]');
    expect(zone).not.toBeNull();
    fireEvent.drop(zone!, { dataTransfer: { files, types: ['Files'] } });
  };

  it('adds dropped images to the list', () => {
    renderDialog();
    dropFiles([
      new File(['x'], 'DSC_0001.jpg', { type: 'image/jpeg' }),
      new File(['x'], 'IMG_2.HEIC', { type: '' }),
      new File(['x'], 'output_FSBS.mp4', { type: 'video/mp4' }),
    ]);
    expect(screen.getByText('DSC_0001.jpg')).toBeInTheDocument();
    expect(screen.getByText('IMG_2.HEIC')).toBeInTheDocument();
    expect(screen.getByText('output_FSBS.mp4')).toBeInTheDocument();
    expect(screen.getByText('Video')).toBeInTheDocument();
    expect(screen.getByText(/3 files ready/)).toBeInTheDocument();
  });

  it('ignores files that are neither images nor videos', () => {
    renderDialog();
    dropFiles([new File(['x'], 'notes.txt', { type: 'text/plain' }), new File(['x'], 'ok.png', { type: 'image/png' })]);
    expect(screen.queryByText('notes.txt')).toBeNull();
    expect(screen.getByText('ok.png')).toBeInTheDocument();
  });
});
