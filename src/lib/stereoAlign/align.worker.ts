/// <reference lib="webworker" />
import { estimateAlignment, type SamplePyramid } from './estimator';

/**
 * Runs the estimator off the main thread. The first Web Worker in this app;
 * the client falls back to running inline where Worker is unavailable.
 */

interface Request {
  id: number;
  pyramid: SamplePyramid;
  swapped: boolean;
}

self.onmessage = (event: MessageEvent<Request>) => {
  const { id, pyramid, swapped } = event.data;
  try {
    const result = estimateAlignment(pyramid, swapped);
    (self as unknown as Worker).postMessage({ id, result });
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
