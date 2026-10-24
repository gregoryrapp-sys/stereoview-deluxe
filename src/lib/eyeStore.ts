/**
 * Persistent store for split eyes, so a photo opened once opens from the
 * device next time without downloading the original and splitting it again.
 *
 * Bytes live in the Cache API (Response bodies, cheap to store, Safari 11.1+);
 * a small index in localStorage tracks size and last use for eviction. The
 * store is an optimisation only: when `caches` is missing (plain http on a
 * LAN), a private window refuses it, or the quota is hit, everything here
 * degrades to a no-op and the viewer works as before.
 *
 * Keys combine the photo's stable identity and alignment (photoCacheKey) with
 * the size tier, so a phone's 1440 px eyes never serve a 4K desktop.
 */

const CACHE_NAME = 'svd-eyes-v1';
const INDEX_KEY = 'svd-eyes-index-v1';
export const MAX_PERSISTED_BYTES = 300 * 1024 * 1024;
const META_HEADER = 'x-svd-meta';
/** Rewrite the index on a hit only if the entry is at least this stale. */
const TOUCH_INTERVAL_MS = 60 * 1000;

export interface PersistedEyeMeta {
  width: number;
  height: number;
  sourceScale: number;
  dx: number;
  dy: number;
  swapped: boolean;
  rotation?: number;
  scale?: number;
}

interface IndexEntry {
  bytes: number;
  lastUsed: number;
}

export interface EyeIndex {
  entries: Record<string, IndexEntry>;
  totalBytes: number;
}

export type EyeSide = 'left' | 'right';

let disabled = false;
let cachePromise: Promise<Cache | null> | null = null;

function available(): boolean {
  return !disabled && typeof caches !== 'undefined' && typeof localStorage !== 'undefined';
}

async function openCache(): Promise<Cache | null> {
  if (!available()) return null;
  if (!cachePromise) {
    cachePromise = caches.open(CACHE_NAME).catch(() => {
      disabled = true;
      return null;
    });
  }
  return cachePromise;
}

function readIndex(): EyeIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as EyeIndex;
      if (parsed && typeof parsed === 'object' && parsed.entries) return parsed;
    }
  } catch {
    // Unreadable index: start over; the reconcile below removes orphans.
  }
  return { entries: {}, totalBytes: 0 };
}

function writeIndex(index: EyeIndex): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch {
    // Storage full or unavailable; the in-memory copy is gone next load,
    // which only costs a few orphaned entries until the reconcile.
  }
}

export function eyeRequestUrl(key: string, tier: string, eye: EyeSide): string {
  // Any https URL is a valid Cache key; the host never resolves.
  return `https://svd-eyes.invalid/v1/${encodeURIComponent(key)}/${tier}/${eye}`;
}

function indexKey(key: string, tier: string): string {
  return `${key}|${tier}`;
}

/** Keys to evict, oldest first, until the incoming bytes fit under the cap. Pure. */
export function planEviction(index: EyeIndex, incomingBytes: number, cap: number): string[] {
  let total = index.totalBytes + incomingBytes;
  if (total <= cap) return [];
  const victims: string[] = [];
  for (const [key, entry] of Object.entries(index.entries).sort((a, b) => a[1].lastUsed - b[1].lastUsed)) {
    if (total <= cap) break;
    victims.push(key);
    total -= entry.bytes;
  }
  return victims;
}

export function metaToHeaders(meta: PersistedEyeMeta): Record<string, string> {
  return { [META_HEADER]: JSON.stringify(meta), 'content-type': 'image/jpeg' };
}

export function headersToMeta(headers: Headers): PersistedEyeMeta | null {
  try {
    const raw = headers.get(META_HEADER);
    if (!raw) return null;
    const meta = JSON.parse(raw) as PersistedEyeMeta;
    return typeof meta.width === 'number' && typeof meta.height === 'number' ? meta : null;
  } catch {
    return null;
  }
}

async function removeEntries(cache: Cache, index: EyeIndex, keys: string[]): Promise<void> {
  for (const composite of keys) {
    const sep = composite.lastIndexOf('|');
    const key = composite.slice(0, sep), tier = composite.slice(sep + 1);
    await Promise.all([cache.delete(eyeRequestUrl(key, tier, 'left')), cache.delete(eyeRequestUrl(key, tier, 'right'))]);
    const entry = index.entries[composite];
    if (entry) {
      index.totalBytes = Math.max(0, index.totalBytes - entry.bytes);
      delete index.entries[composite];
    }
  }
}

export async function readPersistedEyes(
  key: string,
  tier: string,
  eyes: 'left' | 'both',
): Promise<{ left: Blob; right: Blob | null; meta: PersistedEyeMeta } | null> {
  const cache = await openCache();
  if (!cache) return null;
  try {
    const leftRes = await cache.match(eyeRequestUrl(key, tier, 'left'));
    if (!leftRes) return null;
    const meta = headersToMeta(leftRes.headers);
    if (!meta) return null;
    let right: Blob | null = null;
    if (eyes === 'both') {
      const rightRes = await cache.match(eyeRequestUrl(key, tier, 'right'));
      if (!rightRes) return null;
      right = await rightRes.blob();
    }
    const left = await leftRes.blob();

    const index = readIndex();
    const composite = indexKey(key, tier);
    const entry = index.entries[composite];
    const now = Date.now();
    if (!entry) {
      // Known to the cache but not the index (index lost): adopt it.
      index.entries[composite] = { bytes: left.size + (right?.size ?? 0), lastUsed: now };
      index.totalBytes += left.size + (right?.size ?? 0);
      writeIndex(index);
    } else if (now - entry.lastUsed > TOUCH_INTERVAL_MS) {
      entry.lastUsed = now;
      writeIndex(index);
    }
    return { left, right, meta };
  } catch {
    return null;
  }
}

/** Never throws, never delays the caller: fire and forget. */
export async function persistEyes(
  key: string,
  tier: string,
  left: Blob,
  right: Blob | null,
  meta: PersistedEyeMeta,
): Promise<void> {
  const cache = await openCache();
  if (!cache) return;
  const composite = indexKey(key, tier);
  const bytes = left.size + (right?.size ?? 0);
  if (bytes > MAX_PERSISTED_BYTES / 4) return; // one absurd entry must not own the store
  try {
    const index = readIndex();
    const existing = index.entries[composite];
    if (existing) {
      index.totalBytes = Math.max(0, index.totalBytes - existing.bytes);
      delete index.entries[composite];
    }
    await removeEntries(cache, index, planEviction(index, bytes, MAX_PERSISTED_BYTES));

    const put = async () => {
      const headers = metaToHeaders(meta);
      await cache.put(eyeRequestUrl(key, tier, 'left'), new Response(left, { headers }));
      if (right) await cache.put(eyeRequestUrl(key, tier, 'right'), new Response(right, { headers }));
    };
    try {
      await put();
    } catch (error) {
      // Quota: make room (a fifth of the cap) and try once more, then give up for the session.
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        await removeEntries(cache, index, planEviction(index, bytes + MAX_PERSISTED_BYTES / 5, MAX_PERSISTED_BYTES));
        try {
          await put();
        } catch {
          disabled = true;
          writeIndex(index);
          return;
        }
      } else {
        throw error;
      }
    }
    index.entries[composite] = { bytes, lastUsed: Date.now() };
    index.totalBytes += bytes;
    writeIndex(index);
  } catch {
    // Storing is best effort.
  }
}

export async function clearPersistedEyes(): Promise<void> {
  try {
    localStorage.removeItem(INDEX_KEY);
  } catch {
    // ignore
  }
  if (typeof caches === 'undefined') return;
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // ignore
  }
  cachePromise = null;
}

/** Once per session, in idle time: drop cache entries the index no longer knows (multi-tab drift, lost index). */
export function scheduleReconcile(): void {
  if (!available()) return;
  const run = async () => {
    const cache = await openCache();
    if (!cache) return;
    try {
      const index = readIndex();
      const known = new Set<string>();
      for (const composite of Object.keys(index.entries)) {
        const sep = composite.lastIndexOf('|');
        const key = composite.slice(0, sep), tier = composite.slice(sep + 1);
        known.add(eyeRequestUrl(key, tier, 'left'));
        known.add(eyeRequestUrl(key, tier, 'right'));
      }
      for (const request of await cache.keys()) {
        if (!known.has(request.url)) await cache.delete(request);
      }
    } catch {
      // ignore
    }
  };
  const idle = (globalThis as { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback;
  if (idle) idle(() => void run());
  else setTimeout(() => void run(), 5000);
}
