import type { Photo } from '@/data/photos';
import { PHOTOS_BUCKET, supabase } from '@/lib/supabase';
import type { AlbumRecord, EventRecord, PhotoRecord, Profile, ShareLinkRecord, ShareScope } from '@/types/database';

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

const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60;

function safeFileName(name: string) {
  return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
}

export function makeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

async function getPhotoUrl(photo: PhotoRecord): Promise<string> {
  const { data, error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrl(photo.storage_path, SIGNED_URL_EXPIRES_IN_SECONDS);

  if (error || !data?.signedUrl) {
    throw error ?? new Error(`Could not create signed URL for ${photo.storage_path}`);
  }

  return data.signedUrl;
}

async function mapPhotoRowsToGalleryPhotos(photoRows: PhotoRecord[], albums: AlbumRecord[]): Promise<GalleryPhoto[]> {
  const albumEventIds = new Map(albums.map((album) => [album.id, album.event_id]));

  return Promise.all(
    photoRows.map(async (photo) => ({
      id: photo.id,
      src: await getPhotoUrl(photo),
      alt: photo.alt,
      albumId: photo.album_id,
      eventId: albumEventIds.get(photo.album_id),
      storagePath: photo.storage_path,
      created_at: photo.file_modified_at ?? photo.created_at,
      extension: getFileExtension(photo.storage_path),
    })),
  );
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
  return data as DropboxFile[];
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
  const storagePath = `${ownerId}/events/${eventId}/albums/${albumId}/photos/${photoId}/stereo.jpg`;

  const uploadResult = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(storagePath, stereoBlob, {
      cacheControl: '3600',
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
  const storagePath = `${ownerId}/events/${eventId}/albums/${albumId}/photos/${photoId}/stereo.jpg`;

  const uploadResult = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(storagePath, file, {
      cacheControl: '3600',
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
  const { data, error } = await supabase
    .from('events')
    .insert({
      owner_id: ownerId,
      title,
      description: description || null,
      slug: slug ? makeSlug(slug) : undefined,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
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
  const { data, error } = await supabase
    .from('albums')
    .insert({
      event_id: eventId,
      title,
      description: description || null,
      slug: slug ? makeSlug(slug) : null,
      source_type: source_type ?? 'upload',
      dropbox_folder_url: dropbox_folder_url ?? null,
    })
    .select('*')
    .single();

  if (error) {
    throw error;
  }

  return data;
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

  const { error } = await supabase
    .from('profiles')
    .update({
      ...(displayName !== undefined ? { display_name: displayName || null } : {}),
      ...(slug !== undefined ? { slug: makeSlug(slug) } : {}),
      ...coverUpdate,
      ...privacyUpdate,
    })
    .eq('id', profileId);

  if (error) {
    throw error;
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

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke('password-service', {
    body: { type: 'verify', password: password, hash: hash },
  });

  if (error) {
    throw new Error(`Password verification failed: ${error.message}`);
  }
  return data.valid === true;
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

    const newStoragePath = `${ownerId}/events/${destinationEventId}/albums/${destinationAlbumId}/photos/${photo.id}/stereo.jpg`;

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
