import { decodeSpatialEyes, SpatialDecodeError, type SpatialDecodeReason, type SpatialEyes } from './decodeSpatial';
import { loadLibheif } from './loadLibheif';

/**
 * Spatial decoder client: one lazily created module worker, request ids, a
 * timeout, and an inline fallback when Worker is missing or fails to start.
 * Same shape as the alignment estimator's client.
 */

/** Two 12 MP eyes on a slow phone can take a while; the timeout is a safety net, not a budget. */
const REQUEST_TIMEOUT_MS = 90_000;

type Reply = { id: number; result?: SpatialEyes; error?: string; reason?: SpatialDecodeReason };
type Pending = { resolve: (r: SpatialEyes) => void; reject: (e: Error) => void; timer: number };

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function toError(reply: Reply): Error {
  const message = reply.error ?? 'Spatial decode failed';
  return reply.reason ? new SpatialDecodeError(reply.reason, message) : new Error(message);
}

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./spatial.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      window.clearTimeout(entry.timer);
      if (event.data.result) entry.resolve(event.data.result);
      else entry.reject(toError(event.data));
    };
    worker.onerror = () => {
      for (const [id, entry] of pending) {
        window.clearTimeout(entry.timer);
        entry.reject(new Error('Spatial decoder worker crashed'));
        pending.delete(id);
      }
      workerBroken = true;
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

async function decodeInline(bytes: ArrayBuffer): Promise<SpatialEyes> {
  const lib = await loadLibheif();
  return decodeSpatialEyes(lib, new Uint8Array(bytes));
}

/** Decodes both eyes of a spatial HEIC, in the worker when one is available. */
export async function decodeSpatialFile(file: Blob): Promise<SpatialEyes> {
  const bytes = await file.arrayBuffer();
  const w = getWorker();
  if (!w) return decodeInline(bytes);

  return new Promise<SpatialEyes>((resolve, reject) => {
    const id = nextId++;
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error('Spatial decode timed out'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, bytes }, [bytes]);
  }).catch(async (error: Error) => {
    // A crashed worker must not cost the owner the upload; try once inline.
    if (workerBroken && !(error instanceof SpatialDecodeError)) return decodeInline(await file.arrayBuffer());
    throw error;
  });
}
