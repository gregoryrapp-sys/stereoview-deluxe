import type { LibheifModule } from './decodeSpatial';

/**
 * libheif WebAssembly build (about 2 MB, wasm embedded).
 *
 * Two entry points on purpose. The worker imports the bundle statically: Vite
 * builds workers as a single file, and the worker itself is only created when
 * an owner picks a HEIC, so nothing reaches visitors. The main-thread fallback
 * imports it dynamically so it stays out of the main bundle too.
 */

type Factory = (options?: Record<string, unknown>) => unknown;

/** Emscripten factories return the module or a promise of it; older builds expose `ready`. */
export async function initLibheif(factory: Factory): Promise<LibheifModule> {
  let lib = factory() as { then?: unknown; ready?: unknown };
  if (lib && typeof lib.then === 'function') lib = await (lib as unknown as Promise<typeof lib>);
  if (lib?.ready && typeof (lib.ready as Promise<unknown>).then === 'function') {
    const ready = await (lib.ready as Promise<typeof lib | undefined>);
    if (ready) lib = ready;
  }
  return lib as unknown as LibheifModule;
}

let modulePromise: Promise<LibheifModule> | null = null;

/** Lazy main-thread loader; the worker has its own static copy. */
export function loadLibheif(): Promise<LibheifModule> {
  if (!modulePromise) {
    modulePromise = import('libheif-js/libheif-wasm/libheif-bundle.mjs')
      .then((mod) => initLibheif(mod.default))
      .catch((error) => {
        modulePromise = null; // let a later attempt retry after a network blip
        throw error;
      });
  }
  return modulePromise;
}
