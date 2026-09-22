import type { AlbumRecord } from '@/types/database';

/**
 * Whether an album's photos are still streamed from Dropbox at view time.
 *
 * `source_type === 'dropbox'` means "this album has a Dropbox folder behind
 * it" and never changes - shipped Capacitor bundles are frozen on it and keep
 * streaming live. `import_state` says whether the photos have been imported
 * into Storage. Read surfaces (galleries, covers, the viewer) must use THIS
 * predicate, so an album flips from live to imported per row, with no deploy,
 * and flips back with one UPDATE if an import goes wrong.
 *
 * Owner-side code that means "this album is linked to Dropbox" (the folder URL
 * field, the Sync button, the upload restriction) keeps checking source_type.
 */
export function isLiveDropboxAlbum(
  album: Pick<AlbumRecord, 'source_type'> & { import_state?: AlbumRecord['import_state'] } | null | undefined,
): boolean {
  return !!album && album.source_type === 'dropbox' && album.import_state !== 'imported';
}

/** Linked to Dropbox and already serving from Storage. */
export function isImportedDropboxAlbum(
  album: Pick<AlbumRecord, 'source_type'> & { import_state?: AlbumRecord['import_state'] } | null | undefined,
): boolean {
  return !!album && album.source_type === 'dropbox' && album.import_state === 'imported';
}
