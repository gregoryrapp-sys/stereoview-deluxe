import type { Photo } from '@/data/photos';
import { PHOTOS_BUCKET, supabase } from '@/lib/supabase';
import type { AlbumRecord, EventRecord, PhotoRecord, Profile, ShareLinkRecord, ShareScope } from '@/types/database';

export interface GalleryPhoto extends Photo {
  albumId?: string;
  eventId?: string;
  storagePath?: string;
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
    })),
  );
}

export async function fetchGalleryData(): Promise<GalleryData> {
  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('*')
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

interface SharedGalleryRpcData {
  profile: PublicProfile;
  events: EventRecord[];
  albums: AlbumRecord[];
  photos: PhotoRecord[];
}

export async function fetchSharedGalleryBySlugs({
  profileSlug,
  eventSlug,
  albumSlug,
  password,
}: {
  profileSlug: string;
  eventSlug?: string | null;
  albumSlug?: string | null;
  password: string;
}): Promise<SharedGalleryData> {
  const { data, error } = await supabase.rpc('get_shared_gallery_by_slugs', {
    p_profile_slug: profileSlug,
    p_event_slug: eventSlug ?? null,
    p_album_slug: albumSlug ?? null,
    p_password: password,
  });

  if (error) {
    throw error;
  }

  const sharedData = data as SharedGalleryRpcData;
  const photos = await mapPhotoRowsToGalleryPhotos(sharedData.photos, sharedData.albums);

  return {
    profile: sharedData.profile,
    events: sharedData.events,
    albums: sharedData.albums,
    photos,
  };
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
}: {
  eventId: string;
  title: string;
  description?: string;
  slug?: string;
}): Promise<AlbumRecord> {
  const { data, error } = await supabase
    .from('albums')
    .insert({
      event_id: eventId,
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

export async function updateEvent({
  eventId,
  title,
  description,
  slug,
  coverPhotoId,
}: {
  eventId: string;
  title: string;
  description?: string;
  slug?: string;
  coverPhotoId?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({
      title,
      description: description || null,
      ...(slug !== undefined ? { slug: makeSlug(slug) } : {}),
      ...(coverPhotoId !== undefined ? { cover_photo_id: coverPhotoId } : {}),
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
}: {
  albumId: string;
  title: string;
  description?: string;
  slug?: string;
  coverPhotoId?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('albums')
    .update({
      title,
      description: description || null,
      ...(slug !== undefined ? { slug: makeSlug(slug) } : {}),
      ...(coverPhotoId !== undefined ? { cover_photo_id: coverPhotoId } : {}),
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
}: {
  profileId: string;
  displayName?: string | null;
  slug?: string;
  coverPhotoId?: string | null;
}): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      ...(displayName !== undefined ? { display_name: displayName || null } : {}),
      ...(slug !== undefined ? { slug: makeSlug(slug) } : {}),
      ...(coverPhotoId !== undefined ? { cover_photo_id: coverPhotoId } : {}),
    })
    .eq('id', profileId);

  if (error) {
    throw error;
  }
}

export async function createShareLink({
  scope,
  profileId,
  eventId,
  albumId,
  password,
  expiresAt,
}: {
  scope: ShareScope;
  profileId?: string | null;
  eventId?: string | null;
  albumId?: string | null;
  password?: string;
  expiresAt?: string | null;
}): Promise<ShareLinkRecord> {
  const { data, error } = await supabase.rpc('create_share_link', {
    p_scope: scope,
    p_profile_id: profileId ?? null,
    p_event_id: eventId ?? null,
    p_album_id: albumId ?? null,
    p_password: password ?? '',
    p_expires_at: expiresAt ?? null,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function createEventShareLink({
  eventId,
  password,
}: {
  eventId: string;
  password?: string;
}): Promise<ShareLinkRecord> {
  return createShareLink({
    scope: 'event',
    eventId,
    password,
  });
}

export async function fetchShareLinks(): Promise<ShareLinkRecord[]> {
  const { data, error } = await supabase
    .from('share_links')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  return data;
}

export async function revokeShareLink(shareLinkId: string): Promise<void> {
  const { error } = await supabase
    .from('share_links')
    .update({ is_active: false })
    .eq('id', shareLinkId);

  if (error) {
    throw error;
  }
}

export async function verifySharePassword(token: string, password: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('verify_share_password', {
    p_token: token,
    p_password: password,
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function fetchPhotographerDirectory(): Promise<PhotographerDirectoryItem[]> {
  const { data: profiles, error } = await supabase.rpc('get_public_photographers', {});

  if (error) {
    throw error;
  }

  const publicProfiles = profiles as PublicProfile[];
  return publicProfiles.map((profile) => ({ ...profile, coverPhoto: null }));
}

async function removeStorageObjects(paths: string[]) {
  if (paths.length === 0) return;

  const { error } = await supabase.storage.from(PHOTOS_BUCKET).remove(paths);

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
