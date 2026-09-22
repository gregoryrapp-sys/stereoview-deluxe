import { type AlignmentEstimate, estimateAlignment, type SamplePyramid } from './estimator';
import { pyramidTransferables } from './sampler';

/**
 * Estimator client: one lazily created module worker, request ids, a timeout,
 * and an inline fallback when Worker is missing (jsdom, very old WebViews) or
 * fails to start.
 */

const REQUEST_TIMEOUT_MS = 15_000;

type Pending = { resolve: (r: AlignmentEstimate) => void; reject: (e: Error) => void; timer: number };

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (workerBroken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./align.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; result?: AlignmentEstimate; error?: string }>) => {
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      window.clearTimeout(entry.timer);
      if (event.data.result) entry.resolve(event.data.result);
      else entry.reject(new Error(event.data.error ?? 'Estimator failed'));
    };
    worker.onerror = () => {
      // Fail everything in flight and stop using the worker; callers fall back inline.
      for (const [id, entry] of pending) {
        window.clearTimeout(entry.timer);
        entry.reject(new Error('Alignment worker crashed'));
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

export function estimateInWorker(pyramid: SamplePyramid, swapped: boolean): Promise<AlignmentEstimate> {
  const w = getWorker();
  if (!w) return Promise.resolve(estimateAlignment(pyramid, swapped));

  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = window.setTimeout(() => {
      pending.delete(id);
      reject(new Error('Alignment estimate timed out'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    w.postMessage({ id, pyramid, swapped }, pyramidTransferables(pyramid));
  });
}
