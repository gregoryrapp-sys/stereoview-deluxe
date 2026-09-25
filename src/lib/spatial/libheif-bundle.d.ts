/**
 * libheif-js ships no types for its ESM bundle. The default export is the
 * Emscripten module factory; the bundle embeds the .wasm so no locateFile is
 * needed. Typed loosely here and narrowed in loadLibheif.
 */
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const factory: (options?: Record<string, unknown>) => unknown;
  export default factory;
}
