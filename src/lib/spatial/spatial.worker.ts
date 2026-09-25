/// <reference lib="webworker" />
import libheifFactory from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
import { decodeSpatialEyes, type LibheifModule, SpatialDecodeError } from './decodeSpatial';
import { initLibheif } from './loadLibheif';

/**
 * Decodes a spatial HEIC off the main thread. Two 12-megapixel HEVC eyes take
 * a second or two of CPU; the upload dialog stays responsive meanwhile.
 *
 * The static import is deliberate: see loadLibheif.ts.
 */

interface Request {
  id: number;
  bytes: ArrayBuffer;
}

let libPromise: Promise<LibheifModule> | null = null;
const getLib = () => (libPromise ??= initLibheif(libheifFactory));

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, bytes } = event.data;
  try {
    const lib = await getLib();
    const result = await decodeSpatialEyes(lib, new Uint8Array(bytes));
    (self as unknown as Worker).postMessage({ id, result }, [result.left.rgba.buffer, result.right.rgba.buffer]);
  } catch (error) {
    (self as unknown as Worker).postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
      reason: error instanceof SpatialDecodeError ? error.reason : undefined,
    });
  }
};
