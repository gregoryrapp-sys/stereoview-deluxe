import type { Photo } from '@/data/photos';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { PHOTOS_BUCKET, supabase } from '@/lib/supabase';
import { photoObjectPath } from '@/lib/photoPaths';
import type {
  AlbumRecord,
  EventRecord,
  PhotoRecord,
  PhotographerDirectoryRow,
  Profile,
} from '@/types/database';

export interface GalleryPhoto extends Photo {
  albumId?: string;
  eventId?: string;
  storagePath?: string;
  rightSrc?: string; // For Dropbox pairs
  created_at?: string;
  extension?: string; // File extension (lowercase, without dot) when available
}

export interface DropboxFile {
  name: string;
  path_lower: string;
  id: string; // Dropbox ID
  src: string; // Direct download URL for <img> tags
  client_modified?: string; // Dropbox FileMetadata client_modified timestamp
}

export interface GalleryData {
  events: EventRecord[];
  albums: AlbumRecord[];
  photos: GalleryPhoto[];
}

/**
 * Rows as unlock-access/gallery returns them: never with the bcrypt hash, and
 * with `locked: true` on a private row the viewer has not unlocked (a stub with
 * id, slug, title and little else).
 */
export type PublicProfile = Omit<Profile, 'email' | 'password'> & { locked?: boolean };
export type PublicEvent = Omit<EventRecord, 'password'> & { locked?: boolean };
export type PublicAlbum = Omit<AlbumRecord, 'password'> & { locked?: boolean };

export interface SharedGalleryData {
  profile: PublicProfile;
  events: PublicEvent[];
  albums: PublicAlbum[];
  photos: GalleryPhoto[];
}

export interface PhotographerDirectoryItem extends PhotographerDirectoryRow {
  /** Private profile: shown with a lock, PIN required to open. */
  locked: boolean;
  coverPhoto?: GalleryPhoto | null;
  dropboxCoverFolderUrl?: string | null;
  dropboxCoverImageName?: string | null;
}

export type UploadImageSource =
  | {
      kind: 'file';
      file: File;
    }
  | {
      kind: 'url';
      url: string;
      fileName: string;
    };

/**
 * Signed URLs live for a week and are reused from a persisted cache.
 *
 * The old one-hour expiry was minted fresh on every fetch, so the URL string -
 * and with it the browser's HTTP cache key, and every in-app cache key derived
 * from `src` - changed on every single page load. Nothing could ever be a cache
 * hit. It also meant a gallery left open for an hour went dead.
 *
 * The trade is a bounded revocation tail: an album made private stays reachable
 * to whoever already holds a URL until it expires. A week is the deliberate
 * ceiling on that.
 */
const SIGNED_URL_EXPIRES_IN_SECONDS = 7 * 24 * 60 * 60;

/** Re-sign below this much remaining life, so a URL never expires mid-session. */
const SIGNED_URL_MIN_REMAINING_MS = 12 * 60 * 60 * 1000;

/** Supabase caps a single createSignedUrls call; chunk well under it. */
const SIGNED_URL_BATCH_SIZE = 500;

const SIGNED_URL_STORAGE_KEY = 'svd:signed-urls:v1';

/** One year. Photo objects are write-once under a UUID path, so they never change. */
export const PHOTO_CACHE_CONTROL_SECONDS = '31536000';

interface SignedUrlEntry {
  url: string;
  expiresAt: number;
}

let signedUrlCache: Map<string, SignedUrlEntry> | null = null;

function loadSignedUrlCache(): Map<string, SignedUrlEntry> {
  if (signedUrlCache) return signedUrlCache;

  signedUrlCache = new Map();
  try {
    const raw = localStorage.getItem(SIGNED_URL_STORAGE_KEY);
    if (raw) {
      const now = Date.now();
      for (const [path, entry] of Object.entries(JSON.parse(raw) as Record<string, SignedUrlEntry>)) {
        if (entry?.url && entry.expiresAt - now > SIGNED_URL_MIN_REMAINING_MS) {
          signedUrlCache.set(path, entry);
        }
      }
    }
  } catch {
    // Private browsing, cleared site data, or a corrupt entry. Start empty -
    // this cache is an optimisation, never a source of truth.
  }
  return signedUrlCache;
}

function persistSignedUrlCache(): void {
  if (!signedUrlCache) return;
  try {
    localStorage.setItem(
      SIGNED_URL_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(signedUrlCache)),
    );
  } catch {
    // Quota exceeded or storage unavailable; the in-memory cache still works.
  }
}

/**
 * Signs many storage paths in one round trip, reusing still-valid URLs.
 *
 * Replaces one `createSignedUrl` HTTP request per photo - a 200-photo album
 * issued 200 concurrent requests, each running the three-table join inside
 * `can_read_storage_object`, before a single pixel could be requested.
 *
 * Paths that fail to sign are omitted from the result rather than failing the
 * whole gallery. That is safe here in a way it would not be during a sync: this
 * only decides what renders, so a missing object costs one broken tile, whereas
 * a short listing fed into a diff would read as a deletion.
 */
async function signStoragePaths(paths: string[]): Promise<Map<string, string>> {
  const cache = loadSignedUrlCache();
  const now = Date.now();
  const resolved = new Map<string, string>();
  const missing: string[] = [];

  for (const path of new Set(paths)) {
    const entry = cache.get(path);
    if (entry && entry.expiresAt - now > SIGNED_URL_MIN_REMAINING_MS) {
      resolved.set(path, entry.url);
    } else {
      missing.push(path);
    }
  }

  for (let offset = 0; offset < missing.length; offset += SIGNED_URL_BATCH_SIZE) {
    const chunk = missing.slice(offset, offset + SIGNED_URL_BATCH_SIZE);
    const { data, error } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .createSignedUrls(chunk, SIGNED_URL_EXPIRES_IN_SECONDS);

    if (error) throw error;

    const expiresAt = Date.now() + SIGNED_URL_EXPIRES_IN_SECONDS * 1000;
    for (const item of data ?? []) {
      if (!item.path || !item.signedUrl) {
        console.warn('Could not sign storage object:', item.path, item.error);
        continue;
      }
      cache.set(item.path, { url: item.signedUrl, expiresAt });
      resolved.set(item.path, item.signedUrl);
    }
  }

  if (missing.length > 0) persistSignedUrlCache();

  return resolved;
}

function safeFileName(name: string) {
  return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
}

export function makeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    // Apostrophes are dropped rather than treated as separators, so
    // "Ben and Isabel's Wedding" becomes ben-and-isabels-wedding rather than
    // ben-and-isabel-s-wedding. Must stay in step with public.slugify(), which
    // the DB triggers apply when a slug is submitted blank.
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function slugSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

function withSlugCollisionSuffix(base: string): string {
  const suffix = slugSuffix();
  return base ? `${base}-${suffix}` : suffix;
}

export function getFileExtension(nameOrPath: string): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(nameOrPath.trim());
  return match ? match[1].toLowerCase() : '';
}

function getFileModifiedIso(file: File | null | undefined): string | null {
  if (!file || typeof file.lastModified !== 'number' || !file.lastModified) return null;
  return new Date(file.lastModified).toISOString();
}

function getSourceModifiedIso(source: UploadImageSource): string | null {
  return source.kind === 'file' ? getFileModifiedIso(source.file) : null;
}

function loadImageUrl(url: string, label: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();

    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error(`Could not load ${label}`));
    };
    image.src = url;
  });
}

async function loadImageSource(source: UploadImageSource): Promise<HTMLImageElement> {
  if (source.kind === 'file') {
    const url = URL.createObjectURL(source.file);

    try {
      return await loadImageUrl(url, source.file.name);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`Could not download ${source.fileName}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);

  try {
    return await loadImageUrl(url, source.fileName);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawContainedImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  const drawWidth = imageRatio > targetRatio ? width : height * imageRatio;
  const drawHeight = imageRatio > targetRatio ? width / imageRatio : height;
  const offsetX = x + (width - drawWidth) / 2;
  const offsetY = y + (height - drawHeight) / 2;

  context.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
}

async function createStereoPairBlob(leftSource: UploadImageSource, rightSource: UploadImageSource): Promise<Blob> {
  const [leftImage, rightImage] = await Promise.all([
    loadImageSource(leftSource),
    loadImageSource(rightSource),
  ]);

  const halfWidth = Math.min(leftImage.naturalWidth, rightImage.naturalWidth);
  const height = Math.min(leftImage.naturalHeight, rightImage.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = halfWidth * 2;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Could not prepare stereo image');
  }

  context.fillStyle = '#000';
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawContainedImage(context, leftImage, 0, 0, halfWidth, height);
  drawContainedImage(context, rightImage, halfWidth, 0, halfWidth, height);

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Could not encode stereo image'));
        }
      },
      'image/jpeg',
      0.92,
    );
  });
}

async function mapPhotoRowsToGalleryPhotos(photoRows: PhotoRecord[], albums: AlbumRecord[]): Promise<GalleryPhoto[]> {
  const albumEventIds = new Map(albums.map((album) => [album.id, album.event_id]));
  const signedUrls = await signStoragePaths(photoRows.map((photo) => photo.storage_path));

  return photoRows.flatMap((photo) => {
    const src = signedUrls.get(photo.storage_path);
    if (!src) return [];

    return [{
      id: photo.id,
      src,
      alt: photo.alt,
      albumId: photo.album_id,
      eventId: albumEventIds.get(photo.album_id),
      storagePath: photo.storage_path,
      created_at: photo.file_modified_at ?? photo.created_at,
      extension: getFileExtension(photo.storage_path),
    }];
  });
}

export async function fetchGalleryData(ownerId?: string): Promise<GalleryData> {
  let query = supabase
    .from('events')
    .select('*');
  if (ownerId) query = query.eq('owner_id', ownerId);
  const { data: events, error: eventsError } = await query
    .order('created_at', { ascending: false });

  if (eventsError) {
    throw eventsError;
  }

  const eventIds = events.map((event) => event.id);
  if (eventIds.length === 0) {
    return { events, albums: [], photos: [] };
  }

  const { data: albums, error: albumsError } = await supabase
    .from('albums')
    .select('*')
    .in('event_id', eventIds)
    .order('created_at', { ascending: false });

  if (albumsError) {
    throw albumsError;
  }

  const albumIds = albums.map((album) => album.id);
  if (albumIds.length === 0) {
    return { events, albums, photos: [] };
  }

  const { data: photoRows, error: photosError } = await supabase
    .from('photos')
    .select('*')
    .in('album_id', albumIds)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (photosError) {
    throw photosError;
  }

  const photos = await mapPhotoRowsToGalleryPhotos(photoRows, albums);

  return { events, albums, photos };
}

export async function fetchDropboxPhotos(folderUrl: string): Promise<DropboxFile[]> {
  const { data, error } = await supabase.functions.invoke('list-dropbox-files', {
    body: { folderUrl },
  });
  if (error) {
    throw new Error(error.message || 'Failed to fetch Dropbox files');
  }
  // The edge function now returns entries with a direct 'src' URL.
  const files = data as DropboxFile[];
  // Client-side dedupe as safety net for stale/overlapping API data
  const seen = new Set<string>();
  const deduped: DropboxFile[] = [];
  for (const f of files) {
    const key = f.id || f.path_lower || f.name;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(f);
    }
  }
  return deduped;
}

/**
 * Resolves a single representative image for a folder, for use as a thumbnail.
 *
 * Callers wanting a cover previously called `fetchDropboxPhotos` and kept
 * `[0]`, which costs one Dropbox metadata request per file in the folder. With
 * ten uncovered events rendering at once that is a few hundred concurrent
 * Dropbox calls per page load, which exhausts the app's quota and makes even
 * `files/list_folder` return 429. This costs two calls regardless of folder
 * size.
 *
 * Returns null for a folder that contains no images.
 */
export async function fetchDropboxFolderCover(folderUrl: string): Promise<DropboxFile | null> {
  const { data, error } = await supabase.functions.invoke('list-dropbox-files', {
    body: { folderUrl, coverOnly: true },
  });
  if (error) {
    throw new Error(error.message || 'Failed to fetch Dropbox cover');
  }
  return (data as DropboxFile | null) ?? null;
}

export async function fetchDropboxPhoto(folderUrl: string, fileName: string): Promise<DropboxFile> {
  const { data, error } = await supabase.functions.invoke('list-dropbox-files', {
    body: { folderUrl, fileName },
  });
  if (error) {
    throw new Error(error.message || 'Failed to fetch Dropbox file data');
  }
  // The edge function returns a single file object when fileName is provided
  return data as DropboxFile;
}

/**
 * Fetches the binary content (blob) of a single Dropbox file via our proxy edge function.
 * This is used for operations that need pixel data, like image processing, to avoid CORS issues.
 */
export async function fetchDropboxFileBlob({folderUrl,fileName,}: {folderUrl: string;  fileName: string;}): Promise<Blob> {
  const { data, error } = await supabase.functions.invoke('dropbox-file', {
    body: { folderUrl, fileName },
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function uploadStereoPairPhoto({
  albumId,
  eventId,
  ownerId,
  leftSource,
  rightSource,
  alt,
}: {
  albumId: string;
  eventId: string;
  ownerId: string;
  leftSource: UploadImageSource;
  rightSource: UploadImageSource;
  alt: string;
}): Promise<void> {
  const stereoBlob = await createStereoPairBlob(leftSource, rightSource);
  const baseName = safeFileName(alt || 'stereo-photo');
  const photoId = crypto.randomUUID();
  const storagePath = photoObjectPath(ownerId, eventId, albumId, photoId);

  const uploadResult = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(storagePath, stereoBlob, {
      // Immutable by construction: the path carries a per-photo UUID, so these
      // bytes are never replaced in place. An hour was throwing away the cache.
      cacheControl: PHOTO_CACHE_CONTROL_SECONDS,
      contentType: 'image/jpeg',
      upsert: false,
    });

  if (uploadResult.error) {
    throw uploadResult.error;
  }

  const insertResult = await supabase.from('photos').insert({
    id: photoId,
    album_id: albumId,
    storage_path: storagePath,
    alt: baseName,
    file_modified_at: getSourceModifiedIso(leftSource) ?? getSourceModifiedIso(rightSource),
  });

  if (insertResult.error) {
    throw insertResult.error;
  }
}

export async function uploadSbsPhoto({
  albumId,
  eventId,
  ownerId,
  file,
  alt,
}: {
  albumId: string;
  eventId: string;
  ownerId: string;
  file: File;
  alt: string;
}): Promise<void> {
  const baseName = safeFileName(alt || file.name.replace(/\.[^.]+$/, '') || 'stereo-photo');
  const photoId = crypto.randomUUID();
  const storagePath = photoObjectPath(ownerId, eventId, albumId, photoId);

  const uploadResult = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(storagePath, file, {
      cacheControl: PHOTO_CACHE_CONTROL_SECONDS,
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });

  if (uploadResult.error) {
    throw uploadResult.error;
  }

  const insertResult = await supabase.from('photos').insert({
    id: photoId,
    album_id: albumId,
    storage_path: storagePath,
    alt: baseName,
    file_modified_at: getFileModifiedIso(file),
  });

  if (insertResult.error) {
    throw insertResult.error;
  }
}

export async function createEvent({
  ownerId,
  title,
  description,
  slug,
}: {
  ownerId: string;
  title: string;
  description?: string;
  slug?: string;
}): Promise<EventRecord> {
  const baseSlug = slug ? makeSlug(slug) : undefined;
  let attemptSlug: string | undefined = baseSlug;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from('events')
      .insert({
        owner_id: ownerId,
        title,
        description: description || null,
        slug: attemptSlug,
      })
      .select('*')
      .single();
    if (!error) return data;
    const isUniqueViolation = (error as any).code === '23505';
    if (!isUniqueViolation || attempt === 2) throw error;
    attemptSlug = withSlugCollisionSuffix(baseSlug ?? makeSlug(title) ?? 'event');
  }
  throw new Error('Could not create event');
}

export async function createAlbum({
  eventId,
  title,
  description,
  slug,
  source_type,
  dropbox_folder_url,
}: {
  eventId: string;
  title: string;
  description?: string;
  slug?: string;
  source_type?: 'upload' | 'dropbox';
  dropbox_folder_url?: string | null;
}): Promise<AlbumRecord> {
  const baseSlug = slug ? makeSlug(slug) : null;
  let attemptSlug: string | null | undefined = baseSlug;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from('albums')
      .insert({
        event_id: eventId,
        title,
        description: description || null,
        slug: attemptSlug,
        source_type: source_type ?? 'upload',
        dropbox_folder_url: dropbox_folder_url ?? null,
      })
      .select('*')
      .single();
    if (!error) return data;
    const isUniqueViolation = (error as any).code === '23505';
    if (!isUniqueViolation || attempt === 2) throw error;
    attemptSlug = withSlugCollisionSuffix(baseSlug ?? makeSlug(title) ?? 'album');
  }
  throw new Error('Could not create album');
}

export async function updateEvent({
  eventId,
  title,
  description,
  slug,
  coverPhotoId,
  dropboxCoverAlbumId,
  dropboxCoverImageName,
  isPublic,
  isListed,
  password,
}: {
  eventId: string;
  title: string;
  description?: string;
  slug?: string;
  coverPhotoId?: string | null;
  dropboxCoverAlbumId?: string | null;
  dropboxCoverImageName?: string | null;
  isPublic?: boolean;
  isListed?: boolean;
  password?: string | null;
}): Promise<void> {
  const coverUpdate: {
    cover_photo_id?: string | null;
    dropbox_cover_album_id?: string | null;
    dropbox_cover_image_name?: string | null;
  } = {};
  if (dropboxCoverImageName) {
    coverUpdate.dropbox_cover_album_id = dropboxCoverAlbumId;
    coverUpdate.dropbox_cover_image_name = dropboxCoverImageName;
    coverUpdate.cover_photo_id = null;
  } else if (coverPhotoId !== undefined) {
    coverUpdate.cover_photo_id = coverPhotoId;
    coverUpdate.dropbox_cover_album_id = null;
    coverUpdate.dropbox_cover_image_name = null;
  }

  const privacyUpdate: { is_public?: boolean; is_listed?: boolean; password?: string | null } = {};
  if (isPublic !== undefined) {
    privacyUpdate.is_public = isPublic;
  }
  if (isListed !== undefined) {
    privacyUpdate.is_listed = isListed;
  }
  if (password) {
    privacyUpdate.password = await hashPassword(password);
  } else if (password === null) {
    privacyUpdate.password = null;
  }

  // `.select('id')` is what makes an RLS rejection visible. Postgres does not
  // raise when a policy denies an UPDATE - it matches zero rows and reports
  // success - so without this a save that never happened still toasts "saved".
  const { data, error } = await supabase
    .from('events')
    .update({
      title,
      description: description || null,
      ...(slug !== undefined ? { slug: makeSlug(slug) } : {}),
      ...coverUpdate,
      ...privacyUpdate,
    })
    .eq('id', eventId)
    .select('id');

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    throw new Error(
      'Event could not be saved. You may not have permission to update this event.',
    );
  }
}

export async function updateAlbum({
  albumId,
  title,
  description,
  slug,
  coverPhotoId,
  dropboxCoverImageName,
  dropbox_folder_url,
  isPublic,
  isListed,
  password,
}: {
  albumId: string;
  title: string;
  description?: string;
  slug?: string;
  coverPhotoId?: string | null;
  dropboxCoverImageName?: string | null;
  dropbox_folder_url?: string | null;
  isPublic?: boolean;
  isListed?: boolean;
  password?: string | null;
}): Promise<void> {
  const coverUpdate: { cover_photo_id?: string | null; dropbox_cover_image_name?: string | null } = {};
  if (dropboxCoverImageName) {
    coverUpdate.dropbox_cover_image_name = dropboxCoverImageName;
    coverUpdate.cover_photo_id = null;
  } else if (coverPhotoId !== undefined) {
    coverUpdate.cover_photo_id = coverPhotoId;
    coverUpdate.dropbox_cover_image_name = null;
  }

  const privacyUpdate: { is_public?: boolean; is_listed?: boolean; password?: string | null } = {};
  if (isPublic !== undefined) {
    privacyUpdate.is_public = isPublic;
  }
  if (isListed !== undefined) {
    privacyUpdate.is_listed = isListed;
  }
  if (password) {
    privacyUpdate.password = await hashPassword(password);
  } else if (password === null) {
    privacyUpdate.password = null;
  }

  // `.select('id')` is what makes an RLS rejection visible. Postgres does not
  // raise when a policy denies an UPDATE - it matches zero rows and reports
  // success - so without this a save that never happened still toasts "saved".
  const { data, error } = await supabase
    .from('albums')
    .update({
      title: title,
      description: description || null,
      ...(slug !== undefined ? { slug: makeSlug(slug) } : {}),
      ...(dropbox_folder_url !== undefined ? { dropbox_folder_url: dropbox_folder_url } : {}),
      ...coverUpdate,
      ...privacyUpdate,
    })
    .eq('id', albumId)
    .select('id');

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    throw new Error(
      'Album could not be saved. You may not have permission to update this album.',
    );
  }
}


export async function updateProfilePresentation({
  profileId,
  displayName,
  slug,
  coverPhotoId,
  dropboxCoverAlbumId,
  dropboxCoverImageName,
  isPublic,
  isListed,
  password,
}: {
  profileId: string;
  displayName?: string | null;
  slug?: string;
  coverPhotoId?: string | null;
  dropboxCoverAlbumId?: string | null;
  dropboxCoverImageName?: string | null;
  isPublic?: boolean;
  isListed?: boolean;
  password?: string | null;
}): Promise<void> {
  const coverUpdate: {
    cover_photo_id?: string | null;
    dropbox_cover_album_id?: string | null;
    dropbox_cover_image_name?: string | null;
  } = {};
  if (dropboxCoverImageName) {
    coverUpdate.dropbox_cover_album_id = dropboxCoverAlbumId;
    coverUpdate.dropbox_cover_image_name = dropboxCoverImageName;
    coverUpdate.cover_photo_id = null;
  } else if (coverPhotoId) {
    // A specific uploaded photo is chosen
    coverUpdate.cover_photo_id = coverPhotoId;
    coverUpdate.dropbox_cover_album_id = null;
    coverUpdate.dropbox_cover_image_name = null;
  } else if (coverPhotoId === null) {
    // "Automatic" is chosen, clear all cover fields
    coverUpdate.cover_photo_id = null;
    coverUpdate.dropbox_cover_album_id = null;
    coverUpdate.dropbox_cover_image_name = null;
  }

  const privacyUpdate: { is_public?: boolean; is_listed?: boolean; password?: string | null } = {};
  if (isPublic !== undefined) {
    privacyUpdate.is_public = isPublic;
  }
  if (isListed !== undefined) {
    privacyUpdate.is_listed = isListed;
  }
  if (password) {
    privacyUpdate.password = await hashPassword(password);
  } else if (password === null) {
    privacyUpdate.password = null;
  }

  // `.select()` is what makes an RLS rejection visible. Postgres does not raise
  // when a policy denies an UPDATE - the statement simply matches zero rows and
  // returns success. Without checking the returned rows, a profile save that RLS
  // silently discarded reported success to the user, which is exactly how the
  // missing self-update policy went unnoticed for months.
  const { data, error } = await supabase
    .from('profiles')
    .update({
      ...(displayName !== undefined ? { display_name: displayName || null } : {}),
      ...(slug !== undefined ? { slug: makeSlug(slug) } : {}),
      ...coverUpdate,
      ...privacyUpdate,
    })
    .eq('id', profileId)
    .select('id');

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    throw new Error(
      'Profile could not be saved. You may not have permission to update this profile.',
    );
  }
}

export async function hashPassword(password: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('password-service', {
    body: { type: 'hash', password: password },
  });

  if (error) {
    // supabase-js collapses every non-2xx into "Edge Function returned a
    // non-2xx status code" and parks the real Response on `error.context`.
    // The function always answers with `{ error: string }`, and that message
    // ("Authentication required.", "Worker is not defined", ...) is what tells
    // the owner - and us - what actually went wrong.
    let detail = error.message;
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response;
      try {
        const body = await response.json();
        detail = typeof body?.error === 'string' ? body.error : `HTTP ${response.status}`;
      } catch {
        detail = `HTTP ${response.status}`;
      }
      if (response.status === 401) {
        detail = 'Your session has expired. Please sign in again.';
      }
    }
    throw new Error(`Could not set PIN: ${detail}`);
  }
  if (!data || !data.hash) {
    throw new Error('Password service did not return a hash.');
  }
  return data.hash;
}

/**
 * The Photographers page.
 *
 * Reads public.photographer_directory() rather than the profiles table: listed
 * private profiles must appear (with a lock), and a direct table read would
 * either miss them (RLS hides private rows) or hand out their bcrypt hashes.
 * The function returns `has_pin` instead, and no cover fields for private rows.
 */
export async function fetchPublicPhotographers(): Promise<PhotographerDirectoryItem[]> {
  const { data: rows, error: directoryError } = await supabase.rpc('photographer_directory');
  if (directoryError) throw directoryError;

  const profiles = (rows ?? []) as PhotographerDirectoryRow[];

  // Only what the covers need - never every photo of every album.
  const photoIds = profiles.map((p) => p.cover_photo_id).filter((id): id is string => !!id);
  const albumIds = profiles.map((p) => p.dropbox_cover_album_id).filter((id): id is string => !!id);

  const { data: photos, error: photosError } = await supabase.from('photos').select('*').in('id', photoIds);
  if (photosError) throw photosError;

  const { data: albums, error: albumsError } = await supabase.from('albums').select('*').in('id', albumIds);
  if (albumsError) throw albumsError;

  const photoMap = new Map((await mapPhotoRowsToGalleryPhotos(photos, albums)).map((p) => [p.id, p]));

  return profiles.map((profile) => {
    let coverPhoto: GalleryPhoto | null = null;
    let dropboxCoverFolderUrl: string | null = null;
    let dropboxCoverImageName: string | null = null;

    if (profile.dropbox_cover_album_id && profile.dropbox_cover_image_name) {
      const album = albums.find((a) => a.id === profile.dropbox_cover_album_id);
      if (album?.dropbox_folder_url) {
        dropboxCoverFolderUrl = album.dropbox_folder_url;
        dropboxCoverImageName = profile.dropbox_cover_image_name;
        coverPhoto = {
          id: `dropbox-cover-${profile.id}`,
          src: '',
          alt: dropboxCoverImageName,
        };
      }
    } else if (profile.cover_photo_id) {
      coverPhoto = photoMap.get(profile.cover_photo_id) ?? null;
    }

    return {
      ...profile,
      locked: !profile.is_public,
      coverPhoto,
      dropboxCoverFolderUrl,
      dropboxCoverImageName,
    };
  });
}
async function removeStorageObjects(paths: string[]) {
  if (paths.length === 0) return;

  const { error } = await supabase.storage.from(PHOTOS_BUCKET).remove(paths);

  if (error) {
    throw error;
  }
}

export async function deletePhoto(photoId: string, storagePath: string): Promise<void> {
  await removeStorageObjects([storagePath]);

  const { error } = await supabase.from('photos').delete().eq('id', photoId);

  if (error) {
    throw error;
  }
}

export async function deleteAlbumWithPhotos(albumId: string): Promise<void> {
  const { data: photos, error: photosError } = await supabase
    .from('photos')
    .select('storage_path')
    .eq('album_id', albumId);

  if (photosError) {
    throw photosError;
  }

  await removeStorageObjects(photos.map((photo) => photo.storage_path));

  const { error } = await supabase.from('albums').delete().eq('id', albumId);

  if (error) {
    throw error;
  }
}

export async function deleteEventWithPhotos(eventId: string): Promise<void> {
  const { data: albums, error: albumsError } = await supabase
    .from('albums')
    .select('id')
    .eq('event_id', eventId);

  if (albumsError) {
    throw albumsError;
  }

  const albumIds = albums.map((album) => album.id);

  if (albumIds.length > 0) {
    const { data: photos, error: photosError } = await supabase
      .from('photos')
      .select('storage_path')
      .in('album_id', albumIds);

    if (photosError) {
      throw photosError;
    }

    await removeStorageObjects(photos.map((photo) => photo.storage_path));
  }

  const { error } = await supabase.from('events').delete().eq('id', eventId);

  if (error) {
    throw error;
  }
}

export async function movePhotos({
  photoIds,
  destinationAlbumId,
}: {
  photoIds: string[];
  destinationAlbumId: string;
}): Promise<void> {
  if (photoIds.length === 0) return;

  // 1. Get destination album details to find destination event and owner
  const { data: destAlbum, error: destAlbumError } = await supabase
    .from('albums')
    .select('id, event_id, events(owner_id)')
    .eq('id', destinationAlbumId)
    .single();

  if (destAlbumError) throw destAlbumError;
  if (!destAlbum) throw new Error('Destination album not found.');

  const destinationEventId = destAlbum.event_id;
  const ownerId = (destAlbum.events as any)?.owner_id; // type assertion needed due to Supabase join typing

  if (!ownerId) throw new Error('Could not determine owner of photos.');

  // 2. Get source photo details
  const { data: photos, error: photosError } = await supabase.from('photos').select('id, storage_path').in('id', photoIds);

  if (photosError) throw photosError;
  if (photos.length === 0) return;

  // 3. Move each photo
  for (const photo of photos) {
    if (!photo.storage_path) continue;

    const newStoragePath = photoObjectPath(ownerId, destinationEventId, destinationAlbumId, photo.id);

    // 3a. Move file in storage
    const { error: moveError } = await supabase.storage.from(PHOTOS_BUCKET).move(photo.storage_path, newStoragePath);

    if (moveError) {
      throw new Error(`Failed to move file ${photo.id}: ${moveError.message}`);
    }

    // 3b. Update database record
    const { error: updateError } = await supabase.from('photos').update({ album_id: destinationAlbumId, storage_path: newStoragePath }).eq('id', photo.id);

    if (updateError) {
      await supabase.storage.from(PHOTOS_BUCKET).move(newStoragePath, photo.storage_path);
      throw new Error(`Failed to update database for photo ${photo.id}: ${updateError.message}`);
    }
  }
}
