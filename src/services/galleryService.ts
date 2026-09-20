import type { Photo } from '@/data/photos';
import { PHOTOS_BUCKET, supabase } from '@/lib/supabase';
import { deriveThumbPath, photoObjectPath, type ThumbExtension } from '@/lib/photoPaths';
import { makeSbsThumbnail, type SbsThumbnail } from '@/lib/makeThumbnail';
import type { AlbumRecord, EventRecord, PhotoRecord, Profile } from '@/types/database';

export interface GalleryPhoto extends Photo {
  albumId?: string;
  eventId?: string;
  storagePath?: string;
  /** Signed URL of the downscaled whole-SBS thumbnail, when one exists. Grids prefer it. */
  thumbSrc?: string;
  thumbPath?: string;
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

export type PublicProfile = Omit<Profile, 'email'>;

export interface SharedGalleryData extends GalleryData {
  profile: PublicProfile;
}

export interface PhotographerDirectoryItem extends PublicProfile {
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

/** Drops cached URLs for objects that no longer exist at that path (delete / move). */
function forgetSignedPaths(paths: string[]): void {
  const cache = loadSignedUrlCache();
  let changed = false;
  for (const path of paths) {
    if (cache.delete(path)) changed = true;
  }
  if (changed) persistSignedUrlCache();
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

  // Originals and thumbnails are signed in the same batch. A thumbnail that
  // fails to sign costs nothing but the fallback to the original; the photo
  // itself is never dropped over it.
  const paths = photoRows.flatMap((photo) =>
    photo.thumb_path ? [photo.storage_path, photo.thumb_path] : [photo.storage_path],
  );
  const signedUrls = await signStoragePaths(paths);

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
      thumbPath: photo.thumb_path ?? undefined,
      thumbSrc: photo.thumb_path ? signedUrls.get(photo.thumb_path) : undefined,
      created_at: photo.file_modified_at ?? photo.created_at,
      extension: getFileExtension(photo.storage_path),
    }];
  });
}

/**
 * Generates the grid thumbnail for an original that is already in hand.
 * Never throws: a photo without a thumbnail renders from the original, whereas
 * an upload that failed because of its thumbnail would be a lost photo.
 */
async function tryMakeThumbnail(source: Blob): Promise<SbsThumbnail | null> {
  try {
    return await makeSbsThumbnail(source);
  } catch (error) {
    console.warn('Thumbnail generation failed; the grid will use the original.', error);
    return null;
  }
}

/**
 * Uploads a thumbnail beside its original and returns its path, or null if the
 * upload failed. `upsert: true` because the path derives from the original's
 * UUID path, so a regenerated thumbnail legitimately replaces the old one.
 */
async function uploadThumbnail(storagePath: string, thumb: SbsThumbnail): Promise<string | null> {
  const thumbPath = deriveThumbPath(storagePath, thumb.extension);
  const { error } = await supabase.storage.from(PHOTOS_BUCKET).upload(thumbPath, thumb.blob, {
    cacheControl: PHOTO_CACHE_CONTROL_SECONDS,
    contentType: thumb.blob.type,
    upsert: true,
  });
  if (error) {
    console.warn('Thumbnail upload failed; the grid will use the original.', error);
    return null;
  }
  return thumbPath;
}

export interface PhotoMissingThumbnail {
  id: string;
  storage_path: string;
}

const PHOTO_PAGE_SIZE = 1000;

/**
 * Photos in the given albums that have no thumbnail yet, paged explicitly.
 * PostgREST silently truncates at `max_rows = 1000`, so a single select would
 * under-count a large album and the backfill would stop early.
 */
export async function fetchPhotosMissingThumbnails(albumIds: string[]): Promise<PhotoMissingThumbnail[]> {
  if (albumIds.length === 0) return [];
  const rows: PhotoMissingThumbnail[] = [];
  for (let from = 0; ; from += PHOTO_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('photos')
      .select('id, storage_path')
      .in('album_id', albumIds)
      .is('thumb_path', null)
      .order('id')
      .range(from, from + PHOTO_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as PhotoMissingThumbnail[];
    rows.push(...page);
    if (page.length < PHOTO_PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Backfills one thumbnail: downloads the original through a signed URL,
 * generates the thumb in the browser, uploads it and records the path. Runs
 * as the owner, so RLS proves ownership; no service key leaves the server.
 */
export async function backfillPhotoThumbnail(photo: PhotoMissingThumbnail): Promise<void> {
  const signed = await signStoragePaths([photo.storage_path]);
  const url = signed.get(photo.storage_path);
  if (!url) throw new Error('Original could not be signed');

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Original could not be downloaded (HTTP ${response.status})`);

  const thumb = await makeSbsThumbnail(await response.blob());
  const thumbPath = await uploadThumbnail(photo.storage_path, thumb);
  if (!thumbPath) throw new Error('Thumbnail could not be uploaded');

  const { data, error } = await supabase
    .from('photos')
    .update({ thumb_path: thumbPath })
    .eq('id', photo.id)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new Error('Photo row could not be updated');
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
  const thumb = await tryMakeThumbnail(stereoBlob);

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

  const thumbPath = thumb ? await uploadThumbnail(storagePath, thumb) : null;

  const insertResult = await supabase.from('photos').insert({
    id: photoId,
    album_id: albumId,
    storage_path: storagePath,
    thumb_path: thumbPath,
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
  const thumb = await tryMakeThumbnail(file);

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

  const thumbPath = thumb ? await uploadThumbnail(storagePath, thumb) : null;

  const insertResult = await supabase.from('photos').insert({
    id: photoId,
    album_id: albumId,
    storage_path: storagePath,
    thumb_path: thumbPath,
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

  const privacyUpdate: { is_public?: boolean; password?: string | null } = {};
  if (isPublic !== undefined) {
    privacyUpdate.is_public = isPublic;
  }
  if (password) {
    privacyUpdate.password = await hashPassword(password);
  } else if (password === null) {
    privacyUpdate.password = null;
  }

  const { error } = await supabase
    .from('events')
    .update({
      title,
      description: description || null,
      ...(slug !== undefined ? { slug: makeSlug(slug) } : {}),
      ...coverUpdate,
      ...privacyUpdate,
    })
    .eq('id', eventId);

  if (error) {
    throw error;
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

  const privacyUpdate: { is_public?: boolean; password?: string | null } = {};
  if (isPublic !== undefined) {
    privacyUpdate.is_public = isPublic;
  }
  if (password) {
    privacyUpdate.password = await hashPassword(password);
  } else if (password === null) {
    privacyUpdate.password = null;
  }

  const { error } = await supabase
    .from('albums')
    .update({
      title: title,
      description: description || null,
      ...(slug !== undefined ? { slug: makeSlug(slug) } : {}),
      ...(dropbox_folder_url !== undefined ? { dropbox_folder_url: dropbox_folder_url } : {}),
      ...coverUpdate,
      ...privacyUpdate,
    })
    .eq('id', albumId);

  if (error) {
    throw error;
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
  password,
}: {
  profileId: string;
  displayName?: string | null;
  slug?: string;
  coverPhotoId?: string | null;
  dropboxCoverAlbumId?: string | null;
  dropboxCoverImageName?: string | null;
  isPublic?: boolean;
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

  const privacyUpdate: { is_public?: boolean; password?: string | null } = {};
  if (isPublic !== undefined) {
    privacyUpdate.is_public = isPublic;
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
    throw new Error(`Password hashing failed: ${error.message}`);
  }
  if (!data || !data.hash) {
    throw new Error('Password service did not return a hash.');
  }
  return data.hash;
}

export async function fetchPublicPhotographers(): Promise<PhotographerDirectoryItem[]> {
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('*, cover_photo_id, dropbox_cover_album_id, dropbox_cover_image_name')
    .eq('is_public', true);

  if (profilesError) throw profilesError;

  // To avoid fetching all photos/albums, we'll fetch only what's needed for covers.
  const photoIds = profiles.map((p) => p.cover_photo_id).filter((id): id is string => !!id);
  const albumIds = profiles.map((p) => (p as any).dropbox_cover_album_id).filter((id): id is string => !!id);

  const { data: photos, error: photosError } = await supabase.from('photos').select('*').in('id', photoIds);
  if (photosError) throw photosError;

  const { data: albums, error: albumsError } = await supabase.from('albums').select('*').in('id', albumIds);
  if (albumsError) throw albumsError;

  const photoMap = new Map((await mapPhotoRowsToGalleryPhotos(photos, albums)).map((p) => [p.id, p]));

  const photographers = profiles.map((profile) => {
    let coverPhoto: GalleryPhoto | null = null;
    let dropboxCoverFolderUrl: string | null = null;
    let dropboxCoverImageName: string | null = null;

    if ((profile as any).dropbox_cover_album_id && (profile as any).dropbox_cover_image_name) {
      const album = albums.find((a) => a.id === (profile as any).dropbox_cover_album_id);
      if (album?.dropbox_folder_url) {
        dropboxCoverFolderUrl = album.dropbox_folder_url;
        dropboxCoverImageName = (profile as any).dropbox_cover_image_name;
        coverPhoto = {
          id: `dropbox-cover-${profile.id}`,
          src: '',
          alt: dropboxCoverImageName,
        };
      }
    } else if (profile.cover_photo_id) {
      coverPhoto = photoMap.get(profile.cover_photo_id) ?? null;
    }

    return { ...profile, coverPhoto, dropboxCoverFolderUrl, dropboxCoverImageName };
  });

  return photographers;
}

export async function fetchPublicProfileBySlug(slug: string): Promise<SharedGalleryData | null> {
  const { data: profile, error } = await supabase.from('profiles').select('*').eq('slug', slug).single();

  if (error) {
    if (error.code === 'PGRST116') return null; // Not found
    throw error;
  }

  // The RLS policies will ensure only public data is returned.
  const galleryData = await fetchGalleryData(profile.id);
  return { ...galleryData, profile };
}
/** Storage `remove` takes a list; keep each call well under any practical limit. */
const STORAGE_REMOVE_BATCH_SIZE = 100;

async function removeStorageObjects(paths: string[]) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return;

  for (let offset = 0; offset < unique.length; offset += STORAGE_REMOVE_BATCH_SIZE) {
    const { error } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .remove(unique.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE));
    if (error) throw error;
  }

  forgetSignedPaths(unique);
}

/**
 * Every storage object belonging to photos in the given albums - originals and
 * thumbnails - paged past PostgREST's `max_rows` cap so a large album is not
 * silently half-deleted.
 */
async function collectPhotoObjectPaths(albumIds: string[]): Promise<string[]> {
  if (albumIds.length === 0) return [];
  const paths: string[] = [];
  for (let from = 0; ; from += PHOTO_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('photos')
      .select('storage_path, thumb_path')
      .in('album_id', albumIds)
      .order('id')
      .range(from, from + PHOTO_PAGE_SIZE - 1);
    if (error) throw error;
    const page = (data ?? []) as Pick<PhotoRecord, 'storage_path' | 'thumb_path'>[];
    for (const row of page) {
      paths.push(row.storage_path);
      if (row.thumb_path) paths.push(row.thumb_path);
    }
    if (page.length < PHOTO_PAGE_SIZE) break;
  }
  return paths;
}

export async function deletePhoto(
  photoId: string,
  storagePath: string,
  thumbPath?: string | null,
): Promise<void> {
  await removeStorageObjects(thumbPath ? [storagePath, thumbPath] : [storagePath]);

  const { error } = await supabase.from('photos').delete().eq('id', photoId);

  if (error) {
    throw error;
  }
}

export async function deleteAlbumWithPhotos(albumId: string): Promise<void> {
  await removeStorageObjects(await collectPhotoObjectPaths([albumId]));

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

  await removeStorageObjects(await collectPhotoObjectPaths(albums.map((album) => album.id)));

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
  const { data: photoRows, error: photosError } = await supabase
    .from('photos')
    .select('id, storage_path, thumb_path')
    .in('id', photoIds);

  if (photosError) throw photosError;
  const photos = (photoRows ?? []) as Pick<PhotoRecord, 'id' | 'storage_path' | 'thumb_path'>[];
  if (photos.length === 0) return;

  // 3. Move each photo - the original and, when present, its thumbnail
  for (const photo of photos) {
    if (!photo.storage_path) continue;

    // Keep the original's extension rather than forcing `.jpg`: legacy admin
    // uploads may be PNG/WebP, and the stored bytes do not change on a move.
    const extension = getFileExtension(photo.storage_path) || 'jpg';
    const newStoragePath = photoObjectPath(ownerId, destinationEventId, destinationAlbumId, photo.id, extension);
    const newThumbPath = photo.thumb_path
      ? deriveThumbPath(newStoragePath, (getFileExtension(photo.thumb_path) || 'webp') as ThumbExtension)
      : null;

    // 3a. Move files in storage
    const { error: moveError } = await supabase.storage.from(PHOTOS_BUCKET).move(photo.storage_path, newStoragePath);
    if (moveError) {
      throw new Error(`Failed to move file ${photo.id}: ${moveError.message}`);
    }

    if (photo.thumb_path && newThumbPath) {
      const { error: thumbMoveError } = await supabase.storage.from(PHOTOS_BUCKET).move(photo.thumb_path, newThumbPath);
      if (thumbMoveError) {
        await supabase.storage.from(PHOTOS_BUCKET).move(newStoragePath, photo.storage_path);
        throw new Error(`Failed to move thumbnail for ${photo.id}: ${thumbMoveError.message}`);
      }
    }

    // 3b. Update database record; on failure put both objects back
    const { error: updateError } = await supabase
      .from('photos')
      .update({ album_id: destinationAlbumId, storage_path: newStoragePath, thumb_path: newThumbPath })
      .eq('id', photo.id);

    if (updateError) {
      await supabase.storage.from(PHOTOS_BUCKET).move(newStoragePath, photo.storage_path);
      if (photo.thumb_path && newThumbPath) {
        await supabase.storage.from(PHOTOS_BUCKET).move(newThumbPath, photo.thumb_path);
      }
      throw new Error(`Failed to update database for photo ${photo.id}: ${updateError.message}`);
    }

    forgetSignedPaths([photo.storage_path, ...(photo.thumb_path ? [photo.thumb_path] : [])]);
  }
}
