import { findStereoGroup, isHeifBytes } from './heifBoxes';

/**
 * Decodes both eyes of an Apple Spatial Photo with libheif.
 *
 * Pure with respect to the environment: it takes the libheif module as an
 * argument so it runs identically in the Web Worker, inline on the main
 * thread, and against a fake in tests.
 *
 * What a naive integration gets wrong: a spatial HEIC holds dozens of items -
 * two full-size `grid` images, each assembled from hidden 512-pixel `hvc1`
 * tiles, plus depth and thumbnails. `HeifDecoder.decode()` alone returns the
 * top-level images, which is enough on iPhone files, but the eye *order* is
 * only reliable from the `ster` group, so we walk every item ourselves and
 * pair by the group first, same-size siblings second.
 */

export interface EyeImage {
  width: number;
  height: number;
  /** Tightly packed RGBA, `width * 4` bytes per row. */
  rgba: Uint8ClampedArray;
}

export interface SpatialInfo {
  items: number;
  hiddenItems: number;
  visibleImages: { id: number; width: number; height: number; primary: boolean }[];
  stereoGroup: [number, number] | null;
}

export interface SpatialEyes {
  left: EyeImage;
  right: EyeImage;
  info: SpatialInfo;
}

export type SpatialDecodeReason = 'not-heif' | 'no-images' | 'single-image' | 'decode-failed';

export class SpatialDecodeError extends Error {
  constructor(
    public readonly reason: SpatialDecodeReason,
    message: string,
  ) {
    super(message);
    this.name = 'SpatialDecodeError';
  }
}

/**
 * libheif-js reports failure as a plain `heif_error` value object. Its `code`
 * is an embind enum (an object, truthy even when it means "ok"), so it must
 * never be compared as a number; a live handle or a decoded image is an
 * embind class instance with no `code` at all.
 */
interface HeifFailure {
  code: unknown;
  subcode?: unknown;
  message?: string;
}

interface DecodedChannel {
  id: unknown;
  width: number;
  height: number;
  stride: number;
  data: Uint8Array;
}

interface DecodedImage {
  image: unknown;
  channels: DecodedChannel[];
}

/** The slice of libheif-js's embind surface this module touches. */
export interface LibheifModule {
  HeifDecoder: new () => { decode(bytes: Uint8Array): unknown[]; decoder: unknown };
  heif_context_free?: (ctx: unknown) => void;
  heif_context_get_list_of_item_IDs(ctx: unknown): ArrayLike<number>;
  heif_item_is_item_hidden(ctx: unknown, id: number): number;
  heif_js_context_get_image_handle(ctx: unknown, id: number): unknown;
  heif_image_handle_get_width(handle: unknown): number;
  heif_image_handle_get_height(handle: unknown): number;
  heif_image_handle_is_primary_image(handle: unknown): number;
  heif_image_handle_release?: (handle: unknown) => void;
  heif_js_decode_image2(
    handle: unknown,
    colorspace: unknown,
    chroma: unknown,
  ): Promise<DecodedImage | HeifFailure> | DecodedImage | HeifFailure;
  heif_image_release(image: unknown): void;
  heif_colorspace_RGB: unknown;
  heif_chroma_interleaved_RGBA: unknown;
  heif_channel_interleaved: unknown;
}

function isFailure(value: unknown): value is HeifFailure {
  return !!value && typeof value === 'object' && 'code' in value && !('channels' in value);
}

interface VisibleImage {
  id: number;
  handle: unknown;
  width: number;
  height: number;
  primary: boolean;
}

async function decodeHandle(lib: LibheifModule, handle: unknown): Promise<EyeImage> {
  const result = await lib.heif_js_decode_image2(handle, lib.heif_colorspace_RGB, lib.heif_chroma_interleaved_RGBA);
  if (!result) throw new SpatialDecodeError('decode-failed', 'The decoder returned nothing for this image.');
  if (isFailure(result)) {
    throw new SpatialDecodeError('decode-failed', `The decoder could not read this image (${result.message ?? 'unknown error'}).`);
  }
  try {
    const channel = result.channels.find((c) => c.id === lib.heif_channel_interleaved) ?? result.channels[0];
    if (!channel) throw new SpatialDecodeError('decode-failed', 'The decoder returned no pixels.');
    const { width, height, stride, data } = channel;
    const rowBytes = width * 4;
    const rgba = new Uint8ClampedArray(rowBytes * height);
    for (let y = 0; y < height; y++) {
      rgba.set(data.subarray(y * stride, y * stride + rowBytes), y * rowBytes);
    }
    return { width, height, rgba };
  } finally {
    lib.heif_image_release(result.image);
  }
}

export async function decodeSpatialEyes(lib: LibheifModule, bytes: Uint8Array): Promise<SpatialEyes> {
  if (!isHeifBytes(bytes)) {
    throw new SpatialDecodeError('not-heif', 'This is not a HEIC/HEIF file.');
  }

  const decoder = new lib.HeifDecoder();
  decoder.decode(bytes);
  const ctx = decoder.decoder;
  const handles: unknown[] = [];

  try {
    const ids = Array.from(lib.heif_context_get_list_of_item_IDs(ctx) ?? []);
    const stereoGroup = findStereoGroup(bytes);
    const visible: VisibleImage[] = [];
    let hiddenItems = 0;

    for (const id of ids) {
      if (lib.heif_item_is_item_hidden(ctx, id)) {
        hiddenItems++;
        continue;
      }
      const handle = lib.heif_js_context_get_image_handle(ctx, id);
      if (!handle || isFailure(handle)) continue; // not an image item (metadata, depth map, ...)
      handles.push(handle);
      visible.push({
        id,
        handle,
        width: lib.heif_image_handle_get_width(handle),
        height: lib.heif_image_handle_get_height(handle),
        primary: !!lib.heif_image_handle_is_primary_image(handle),
      });
    }

    const info: SpatialInfo = {
      items: ids.length,
      hiddenItems,
      visibleImages: visible.map(({ id, width, height, primary }) => ({ id, width, height, primary })),
      stereoGroup,
    };

    if (visible.length === 0) {
      throw new SpatialDecodeError('no-images', 'No image could be found inside this file.');
    }

    const byId = (id: number) => visible.find((v) => v.id === id);
    const left = (stereoGroup && byId(stereoGroup[0])) || visible.find((v) => v.primary) || visible[0];
    const right =
      (stereoGroup && byId(stereoGroup[1])) ||
      visible.find((v) => v !== left && v.width === left.width && v.height === left.height);

    if (!right || right === left) {
      throw new SpatialDecodeError(
        'single-image',
        'Not a spatial photo: the file holds only one full-size image. Export it from Photos with "Export Unmodified Original".',
      );
    }

    const leftEye = await decodeHandle(lib, left.handle);
    const rightEye = await decodeHandle(lib, right.handle);
    return { left: leftEye, right: rightEye, info };
  } finally {
    for (const handle of handles) lib.heif_image_handle_release?.(handle);
    lib.heif_context_free?.(ctx);
  }
}
