/**
 * Side-by-side videos are stored and listed exactly like photos (a photos
 * row, an original in Storage, a poster as the thumbnail). Whether a row is a
 * video is read from its file extension; nothing else in the data changes.
 */
export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v'] as const;

const VIDEO_EXTENSION_PATTERN = /\.(mp4|mov|m4v)$/i;

/** A storage path or URL that names a video (query strings ignored). */
export function isVideoPath(path: string | null | undefined): boolean {
  if (!path) return false;
  return VIDEO_EXTENSION_PATTERN.test(path.split(/[?#]/)[0]);
}

/** A picked or dropped file that is a video we accept. */
export function isVideoFile(file: Pick<File, 'name' | 'type'>): boolean {
  return VIDEO_EXTENSION_PATTERN.test(file.name) || /^video\/(mp4|quicktime|x-m4v)$/i.test(file.type);
}

/** A gallery item that is a video: its storage path, else its source URL. */
export function isVideoPhoto(photo: { src?: string; storagePath?: string | null }): boolean {
  return isVideoPath(photo.storagePath) || isVideoPath(photo.src);
}

/** The MIME type to store a video with; browsers pick the player from it. */
export function videoContentType(file: Pick<File, 'name' | 'type'>): string {
  if (/^video\//i.test(file.type)) return file.type;
  if (/\.mov$/i.test(file.name)) return 'video/quicktime';
  if (/\.m4v$/i.test(file.name)) return 'video/x-m4v';
  return 'video/mp4';
}

/**
 * Apple Spatial Photos arrive as .HEIC and are converted in the browser; the
 * extension entries matter because Safari and Chrome disagree on the MIME type
 * a picker reports for HEIC.
 */
export const ACCEPTED_TYPES =
  'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif,video/mp4,video/quicktime,.mp4,.mov,.m4v';

/**
 * Dropped files bypass the picker's `accept` filter, so apply the same rule by
 * hand. Extension first: HEIC arrives with an empty or vendor MIME type.
 */
export function isAcceptedFile(file: Pick<File, 'name' | 'type'>): boolean {
  return (
    /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name) ||
    /^image\/(jpeg|png|webp|hei[cf])$/i.test(file.type) ||
    isVideoFile(file)
  );
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
