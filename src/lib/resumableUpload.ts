/**
 * Resumable uploads to Supabase Storage (the TUS protocol), for videos of
 * hundreds of megabytes.
 *
 * The file goes up in 6 MB chunks (the chunk size Supabase requires). When the
 * connection drops, the server is asked how much it already has and the upload
 * continues from there, with a few automatic retries. The upload's address is
 * remembered in localStorage under a fingerprint of the file, so "Retry" - or
 * picking the same file again after a page reload - resumes rather than
 * starting over. Supabase keeps an unfinished upload for 24 hours.
 *
 * Written against the protocol directly (create = POST, chunk = PATCH,
 * offset = HEAD) rather than a client library; it is the whole of what the
 * app needs.
 */

/** Supabase accepts exactly this chunk size for resumable uploads. */
export const CHUNK_SIZE = 6 * 1024 * 1024;

/** Waits before each automatic retry; after the last one the error surfaces. */
const DEFAULT_RETRY_DELAYS_MS = [1000, 3000, 5000, 10000, 20000];

/** Supabase forgets unfinished uploads after a day; so does this. */
const SAVED_UPLOAD_MAX_AGE_MS = 23 * 60 * 60 * 1000;

const STORAGE_PREFIX = 'resumable-upload:';

export interface TransportRequest {
  method: 'POST' | 'PATCH' | 'HEAD';
  url: string;
  headers: Record<string, string>;
  body?: Blob;
  /** Bytes of `body` sent so far. */
  onUploadProgress?: (sent: number) => void;
}

export interface TransportResponse {
  /** 0 when the request never got an answer (offline, connection dropped). */
  status: number;
  header: (name: string) => string | null;
  text: string;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SavedUpload {
  uploadUrl: string;
  objectName: string;
  savedAt: number;
}

export interface ResumableUploadOptions {
  /** `${SUPABASE_URL}/storage/v1/upload/resumable` */
  endpoint: string;
  bucket: string;
  objectName: string;
  file: Blob;
  contentType: string;
  /** Seconds, as Storage's cacheControl. */
  cacheControl: string;
  /** Fresh auth headers for every request: a long upload outlives an access token. */
  getHeaders: () => Promise<Record<string, string>>;
  /** Identifies this file across retries and reloads; see videoUploadFingerprint. */
  fingerprint: string;
  onProgress?: (fraction: number) => void;
  /** Injected in tests. */
  transport?: Transport;
  store?: KeyValueStore | null;
  retryDelaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'UploadError';
  }
}

/** The same file going to the same album: its name, size and modified time. */
export function videoUploadFingerprint(albumId: string, file: Pick<File, 'name' | 'size' | 'lastModified'>): string {
  return `${albumId}:${file.name}:${file.size}:${file.lastModified}`;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // private mode or blocked storage: uploads still work, without resume across reloads
  }
}

/** An unfinished upload of this file that can still be resumed, if any. */
export function findSavedUpload(fingerprint: string, store: KeyValueStore | null = defaultStore(), now = Date.now()): SavedUpload | null {
  try {
    const raw = store?.getItem(STORAGE_PREFIX + fingerprint);
    if (!raw) return null;
    const saved = JSON.parse(raw) as SavedUpload;
    if (!saved.uploadUrl || !saved.objectName || now - saved.savedAt > SAVED_UPLOAD_MAX_AGE_MS) {
      store?.removeItem(STORAGE_PREFIX + fingerprint);
      return null;
    }
    return saved;
  } catch {
    return null;
  }
}

function saveUpload(store: KeyValueStore | null, fingerprint: string, saved: SavedUpload) {
  try {
    store?.setItem(STORAGE_PREFIX + fingerprint, JSON.stringify(saved));
  } catch {
    // Storage full or blocked: resume within this session still works.
  }
}

function forgetUpload(store: KeyValueStore | null, fingerprint: string) {
  try {
    store?.removeItem(STORAGE_PREFIX + fingerprint);
  } catch {
    // Nothing to do.
  }
}

/** XMLHttpRequest, for upload progress; fetch has none. */
export const xhrTransport: Transport = ({ method, url, headers, body, onUploadProgress }) =>
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    if (onUploadProgress) {
      xhr.upload.onprogress = (event) => onUploadProgress(event.loaded);
    }
    const done = () =>
      resolve({ status: xhr.status, header: (name) => xhr.getResponseHeader(name), text: xhr.responseText ?? '' });
    xhr.onload = done;
    xhr.onerror = done;
    xhr.ontimeout = done;
    xhr.onabort = done;
    xhr.send(body ?? null);
  });

const base64 = (value: string) => btoa(unescape(encodeURIComponent(value)));

function serverMessage(response: TransportResponse): string {
  try {
    const parsed = JSON.parse(response.text);
    return parsed.message ?? parsed.error ?? response.text;
  } catch {
    return response.text;
  }
}

/** Turns a refusal into something the photographer can act on. */
function failure(response: TransportResponse, action: string, fileSize: number): UploadError {
  const message = serverMessage(response);
  const status = response.status;
  if (status === 0) {
    return new UploadError('The connection dropped.', 0, true);
  }
  if (status === 413 || /maximum allowed size|too large|exceeded/i.test(message)) {
    return new UploadError(
      `The video is larger than Storage accepts (${Math.round(fileSize / 1024 / 1024)} MB). Raise the upload size limit in Supabase.`,
      status,
      false,
    );
  }
  if (/mime type/i.test(message)) {
    return new UploadError('Storage does not accept videos yet. The database update for videos needs to be applied.', status, false);
  }
  // 401: the access token expired mid-upload; the next attempt fetches a fresh
  // one. 409/423: the offset moved or the upload is locked; asking again
  // settles it. 5xx: the server's own trouble.
  const retryable = status === 401 || status === 409 || status === 423 || status === 429 || status >= 500;
  return new UploadError(`${action} failed (HTTP ${status})${message ? `: ${message}` : ''}`, status, retryable);
}

/**
 * Uploads `file` to `bucket/objectName`, resuming a saved upload of the same
 * file when there is one. Resolves when Storage has every byte.
 */
export async function resumableUpload(options: ResumableUploadOptions): Promise<void> {
  const {
    endpoint,
    bucket,
    objectName,
    file,
    contentType,
    cacheControl,
    getHeaders,
    fingerprint,
    onProgress,
    transport = xhrTransport,
    store = defaultStore(),
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  const size = file.size;

  const saved = findSavedUpload(fingerprint, store);
  let uploadUrl: string | null = saved && saved.objectName === objectName ? saved.uploadUrl : null;
  let offset = 0;

  const headersFor = async (extra: Record<string, string>) => ({ ...(await getHeaders()), 'tus-resumable': '1.0.0', ...extra });

  const create = async (): Promise<string> => {
    const metadata = [
      `bucketName ${base64(bucket)}`,
      `objectName ${base64(objectName)}`,
      `contentType ${base64(contentType)}`,
      `cacheControl ${base64(cacheControl)}`,
    ].join(',');
    const response = await transport({
      method: 'POST',
      url: endpoint,
      headers: await headersFor({ 'upload-length': String(size), 'upload-metadata': metadata, 'x-upsert': 'false' }),
    });
    const location = response.header('location');
    if (response.status !== 201 || !location) throw failure(response, 'Starting the upload', size);
    return new URL(location, endpoint).toString();
  };

  /** How many bytes the server has; null when it no longer knows this upload. */
  const currentOffset = async (url: string): Promise<number | null> => {
    const response = await transport({ method: 'HEAD', url, headers: await headersFor({}) });
    if (response.status === 404 || response.status === 410) return null;
    const value = Number(response.header('upload-offset'));
    if (response.status < 200 || response.status >= 300 || !Number.isFinite(value)) {
      throw failure(response, 'Checking the upload', size);
    }
    return value;
  };

  const sendChunk = async (url: string, from: number): Promise<number> => {
    const chunk = file.slice(from, Math.min(from + CHUNK_SIZE, size));
    const response = await transport({
      method: 'PATCH',
      url,
      headers: await headersFor({ 'upload-offset': String(from), 'content-type': 'application/offset+octet-stream' }),
      body: chunk,
      onUploadProgress: (sent) => onProgress?.(Math.min(1, (from + sent) / size)),
    });
    const value = Number(response.header('upload-offset'));
    if (response.status !== 204 || !Number.isFinite(value)) throw failure(response, 'Uploading', size);
    return value;
  };

  for (let attempt = 0; ; attempt++) {
    try {
      if (uploadUrl) {
        const known = await currentOffset(uploadUrl);
        if (known === null) {
          // Expired or never finished being created: start a new upload.
          uploadUrl = null;
          forgetUpload(store, fingerprint);
        } else {
          offset = known;
        }
      }
      if (!uploadUrl) {
        uploadUrl = await create();
        offset = 0;
        saveUpload(store, fingerprint, { uploadUrl, objectName, savedAt: Date.now() });
      }
      onProgress?.(size === 0 ? 1 : offset / size);
      while (offset < size) {
        offset = await sendChunk(uploadUrl, offset);
        onProgress?.(offset / size);
      }
      forgetUpload(store, fingerprint);
      return;
    } catch (error) {
      // Anything that is not a transfer failure (e.g. signed out) will not
      // fix itself by waiting.
      const retryable = error instanceof UploadError && error.retryable;
      if (!retryable || attempt >= retryDelaysMs.length) {
        if (error instanceof UploadError && error.status === 0) {
          throw new UploadError('The connection dropped. Press Retry to continue where it stopped.', 0, true);
        }
        throw error;
      }
      await sleep(retryDelaysMs[attempt]);
    }
  }
}
