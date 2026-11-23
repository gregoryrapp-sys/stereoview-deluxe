import { describe, expect, it } from 'vitest';
import {
  CHUNK_SIZE,
  findSavedUpload,
  resumableUpload,
  type Transport,
  type TransportResponse,
  UploadError,
  videoUploadFingerprint,
} from './resumableUpload';

/** An in-memory TUS server: uploads by URL, with ways to make requests fail. */
function fakeServer() {
  const uploads = new Map<string, { length: number; received: number }>();
  let next = 1;
  const log: string[] = [];
  const failures: Array<(method: string) => TransportResponse | null> = [];
  const res = (status: number, headers: Record<string, string> = {}, text = ''): TransportResponse => ({
    status,
    header: (name) => headers[name.toLowerCase()] ?? null,
    text,
  });
  const transport: Transport = async ({ method, url, headers, body, onUploadProgress }) => {
    log.push(method);
    for (const fail of failures.splice(0, 1)) {
      const response = fail(method);
      if (response) return response;
    }
    if (method === 'POST') {
      const location = `/storage/v1/upload/resumable/upload-${next++}`;
      uploads.set(location, { length: Number(headers['upload-length']), received: 0 });
      return res(201, { location });
    }
    const upload = uploads.get(new URL(url).pathname);
    if (!upload) return res(404);
    if (method === 'HEAD') return res(200, { 'upload-offset': String(upload.received) });
    if (Number(headers['upload-offset']) !== upload.received) return res(409, {}, 'offset mismatch');
    upload.received += body!.size;
    onUploadProgress?.(body!.size);
    return res(204, { 'upload-offset': String(upload.received) });
  };
  return { transport, uploads, log, failures };
}

function memoryStore() {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const file = new Blob([new Uint8Array(CHUNK_SIZE * 2 + 1000)]);
const base = (server: ReturnType<typeof fakeServer>, store = memoryStore()) => ({
  endpoint: 'https://x.supabase.co/storage/v1/upload/resumable',
  bucket: 'photos',
  objectName: 'owner/e/a/photos/v.mp4',
  file,
  contentType: 'video/mp4',
  cacheControl: '31536000',
  getHeaders: async () => ({ authorization: 'Bearer t' }),
  fingerprint: 'album:v.mp4:1:2',
  transport: server.transport,
  store,
  sleep: async () => {},
});

describe('resumableUpload', () => {
  it('sends the file in 6 MB chunks and forgets the upload when done', async () => {
    const server = fakeServer();
    const store = memoryStore();
    const progress: number[] = [];
    await resumableUpload({ ...base(server, store), onProgress: (f) => progress.push(f) });
    expect(server.log).toEqual(['POST', 'PATCH', 'PATCH', 'PATCH']);
    expect([...server.uploads.values()][0].received).toBe(file.size);
    expect(progress.at(-1)).toBe(1);
    expect(store.data.size).toBe(0);
  });

  it('continues from what the server has after the connection drops', async () => {
    const server = fakeServer();
    // Second chunk: the connection drops.
    server.failures.push(() => null, () => null, (method) => (method === 'PATCH' ? { status: 0, header: () => null, text: '' } : null));
    await resumableUpload(base(server));
    expect(server.log).toEqual(['POST', 'PATCH', 'PATCH', 'HEAD', 'PATCH', 'PATCH']);
    expect([...server.uploads.values()][0].received).toBe(file.size);
  });

  it('resumes a saved upload of the same file (Retry, or a reload)', async () => {
    const server = fakeServer();
    const store = memoryStore();
    // First run: the connection is gone for good after one chunk.
    let calls = 0;
    const flaky: Transport = (req) => (++calls > 2 ? Promise.resolve({ status: 0, header: () => null, text: '' }) : server.transport(req));
    await expect(resumableUpload({ ...base(server, store), transport: flaky, retryDelaysMs: [] })).rejects.toThrow(/Press Retry/);
    expect(findSavedUpload('album:v.mp4:1:2', store)?.objectName).toBe('owner/e/a/photos/v.mp4');

    server.log.length = 0;
    await resumableUpload(base(server, store));
    expect(server.log).toEqual(['HEAD', 'PATCH', 'PATCH']);
    expect([...server.uploads.values()][0].received).toBe(file.size);
  });

  it('starts over when the server no longer knows the saved upload', async () => {
    const server = fakeServer();
    const store = memoryStore();
    store.setItem('resumable-upload:album:v.mp4:1:2', JSON.stringify({ uploadUrl: 'https://x.supabase.co/storage/v1/upload/resumable/gone', objectName: 'owner/e/a/photos/v.mp4', savedAt: Date.now() }));
    await resumableUpload(base(server, store));
    expect(server.log).toEqual(['HEAD', 'POST', 'PATCH', 'PATCH', 'PATCH']);
  });

  it('stops at once, in plain words, when Storage refuses the size', async () => {
    const server = fakeServer();
    server.failures.push(() => ({ status: 413, header: () => null, text: '{"message":"Payload too large"}' }));
    const error = await resumableUpload(base(server)).catch((e) => e);
    expect(error).toBeInstanceOf(UploadError);
    expect(error.message).toMatch(/Raise the upload size limit/);
    expect(server.log).toEqual(['POST']);
  });

  it('ignores a saved upload older than Supabase keeps them', () => {
    const store = memoryStore();
    store.setItem('resumable-upload:f', JSON.stringify({ uploadUrl: 'u', objectName: 'o', savedAt: 0 }));
    expect(findSavedUpload('f', store, 24 * 60 * 60 * 1000)).toBeNull();
    expect(store.data.size).toBe(0);
  });
});

describe('videoUploadFingerprint', () => {
  it('is the same for the same file in the same album', () => {
    const f = { name: 'a.mp4', size: 10, lastModified: 5 };
    expect(videoUploadFingerprint('al', f)).toBe(videoUploadFingerprint('al', { ...f }));
    expect(videoUploadFingerprint('al', f)).not.toBe(videoUploadFingerprint('other', f));
  });
});
