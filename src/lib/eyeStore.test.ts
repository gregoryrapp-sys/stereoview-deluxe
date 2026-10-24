// @vitest-environment node
// jsdom's Blob and the fetch Response do not interoperate (the body ends up
// stringified), so this store test runs on Node's own Blob/Response, which is
// how browsers behave.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const blob = (text: string) => new Blob([text]);
import {
  clearPersistedEyes,
  eyeRequestUrl,
  headersToMeta,
  MAX_PERSISTED_BYTES,
  metaToHeaders,
  persistEyes,
  planEviction,
  readPersistedEyes,
} from './eyeStore';

/** A ~40-line in-memory stand-in for CacheStorage/Cache; jsdom has none. */
class FakeCache {
  store = new Map<string, Response>();
  async match(url: string) { return this.store.get(url) ?? undefined; }
  async put(url: string, res: Response) { this.store.set(url, res); }
  async delete(url: string | Request) { return this.store.delete(typeof url === 'string' ? url : url.url); }
  async keys() { return Array.from(this.store.keys()).map((u) => new Request(u)); }
}
class FakeCaches {
  caches = new Map<string, FakeCache>();
  async open(name: string) { let c = this.caches.get(name); if (!c) { c = new FakeCache(); this.caches.set(name, c); } return c as unknown as Cache; }
  async delete(name: string) { return this.caches.delete(name); }
}

const meta = { width: 100, height: 80, sourceScale: 0.5, dx: 1, dy: -2, swapped: false, rotation: 0.3 };

/** Node's own localStorage global is undefined without a flag and shadows jsdom's; use a tiny in-memory one. */
class FakeStorage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

describe('eyeStore', () => {
  beforeEach(() => {
    (globalThis as { caches?: unknown }).caches = new FakeCaches();
    Object.defineProperty(globalThis, 'localStorage', { value: new FakeStorage(), configurable: true, writable: true });
  });
  afterEach(async () => {
    await clearPersistedEyes();
    delete (globalThis as { caches?: unknown }).caches;
  });

  it('round-trips both eyes and their metadata', async () => {
    await persistEyes('k1', 'fit', blob('LLLL'), blob('RR'), meta);
    const hit = await readPersistedEyes('k1', 'fit', 'both');
    expect(hit).not.toBeNull();
    expect(await new Response(hit!.left).text()).toBe('LLLL');
    expect(await new Response(hit!.right!).text()).toBe('RR');
    expect(hit!.meta).toEqual(meta);
    expect(JSON.parse(localStorage.getItem('svd-eyes-index-v1')!).totalBytes).toBe(6);
  });

  it("serves a left-only request from a 'both' entry, and misses a 'both' request on a left-only entry", async () => {
    await persistEyes('k2', 'fit', blob('L'), blob('R'), meta);
    expect(await readPersistedEyes('k2', 'fit', 'left')).not.toBeNull();
    await persistEyes('k3', 'fit', blob('L'), null, meta);
    expect(await readPersistedEyes('k3', 'fit', 'both')).toBeNull();
    expect(await readPersistedEyes('k3', 'fit', 'left')).not.toBeNull();
  });

  it('keys are distinct per tier and eye', () => {
    expect(eyeRequestUrl('k', 'fit', 'left')).not.toBe(eyeRequestUrl('k', 'zoom', 'left'));
    expect(eyeRequestUrl('k', 'fit', 'left')).not.toBe(eyeRequestUrl('k', 'fit', 'right'));
    expect(headersToMeta(new Headers(metaToHeaders(meta)))).toEqual(meta);
  });

  it('evicts the least recently used entries until the incoming bytes fit', () => {
    const index = { entries: { a: { bytes: 50, lastUsed: 3 }, b: { bytes: 30, lastUsed: 1 }, c: { bytes: 40, lastUsed: 2 } }, totalBytes: 120 };
    expect(planEviction(index, 10, 200)).toEqual([]);
    expect(planEviction(index, 10, 100)).toEqual(['b']);
    expect(planEviction(index, 10, 60)).toEqual(['b', 'c']);
  });

  it('is a silent no-op without the Cache API', async () => {
    delete (globalThis as { caches?: unknown }).caches;
    await expect(persistEyes('k4', 'fit', blob('L'), null, meta)).resolves.toBeUndefined();
    expect(await readPersistedEyes('k4', 'fit', 'left')).toBeNull();
  });

  it('refuses one entry larger than a quarter of the cap', async () => {
    const huge = new Blob([new Uint8Array(MAX_PERSISTED_BYTES / 4 + 1)]);
    await persistEyes('k5', 'fit', huge, null, meta);
    expect(await readPersistedEyes('k5', 'fit', 'left')).toBeNull();
  });
});
