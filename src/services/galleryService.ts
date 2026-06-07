import type { Photo } from '@/data/photos';
import { PHOTOS_BUCKET, supabase } from '@/lib/supabase';
import type { AlbumRecord, EventRecord, PhotoRecord } from '@/types/database';

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

  const albumEventIds = new Map(albums.map((album) => [album.id, album.event_id]));
  const photos = await Promise.all(
    photoRows.map(async (photo) => ({
      id: photo.id,
      src: await getPhotoUrl(photo),
      alt: photo.alt,
      albumId: photo.album_id,
      eventId: albumEventIds.get(photo.album_id),
      storagePath: photo.storage_path,
    })),
  );

  return { events, albums, photos };
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

export async function createEvent({
  ownerId,
  title,
  description,
}: {
  ownerId: string;
  title: string;
  description?: string;
}): Promise<EventRecord> {
  const { data, error } = await supabase
    .from('events')
    .insert({
      owner_id: ownerId,
      title,
      description: description || null,
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
}: {
  eventId: string;
  title: string;
  description?: string;
}): Promise<AlbumRecord> {
  const { data, error } = await supabase
    .from('albums')
    .insert({
      event_id: eventId,
      title,
      description: description || null,
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
}: {
  eventId: string;
  title: string;
  description?: string;
}): Promise<void> {
  const { error } = await supabase
    .from('events')
    .update({
      title,
      description: description || null,
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
}: {
  albumId: string;
  title: string;
  description?: string;
}): Promise<void> {
  const { error } = await supabase
    .from('albums')
    .update({
      title,
      description: description || null,
    })
    .eq('id', albumId);

  if (error) {
    throw error;
  }
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
