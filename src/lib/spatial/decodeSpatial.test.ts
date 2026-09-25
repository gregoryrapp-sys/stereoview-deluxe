import { describe, expect, it } from 'vitest';
import { decodeSpatialEyes, type LibheifModule, SpatialDecodeError } from './decodeSpatial';
import { plainSkeleton, spatialSkeleton } from './heifBoxes.testutil';

/** Fake libheif: items are described by a table; decoding paints a per-item grey. */
interface FakeItem {
  id: number;
  hidden?: boolean;
  image?: { width: number; height: number; primary?: boolean };
}

function fakeLib(items: FakeItem[], log: string[] = []): LibheifModule {
  const ctx = { items };
  const CHROMA = 'rgba';
  return {
    HeifDecoder: class {
      decoder = ctx;
      decode() {
        return items.filter((i) => i.image && !i.hidden);
      }
    },
    heif_context_free: () => log.push('free-ctx'),
    heif_context_get_list_of_item_IDs: () => items.map((i) => i.id),
    heif_item_is_item_hidden: (_c, id) => (items.find((i) => i.id === id)?.hidden ? 1 : 0),
    heif_js_context_get_image_handle: (_c, id) => {
      const item = items.find((i) => i.id === id);
      // Real libheif-js: `code` is an embind enum object, not a number.
      return item?.image ? { id, ...item.image } : { code: { value: 1 }, subcode: { value: 0 }, message: 'not an image' };
    },
    heif_image_handle_get_width: (h: { width: number }) => h.width,
    heif_image_handle_get_height: (h: { height: number }) => h.height,
    heif_image_handle_is_primary_image: (h: { primary?: boolean }) => (h.primary ? 1 : 0),
    heif_image_handle_release: (h: { id: number }) => log.push(`release-handle-${h.id}`),
    heif_js_decode_image2: async (h: { id: number; width: number; height: number }) => {
      // Stride wider than the row, as real decoders pad, to prove the repack.
      const stride = h.width * 4 + 16;
      const data = new Uint8Array(stride * h.height).fill(h.id);
      return { image: { id: h.id }, channels: [{ id: CHROMA, width: h.width, height: h.height, stride, data }] };
    },
    heif_image_release: (img: { id: number }) => log.push(`release-image-${img.id}`),
    heif_colorspace_RGB: 'rgb',
    heif_chroma_interleaved_RGBA: CHROMA,
    heif_channel_interleaved: CHROMA,
  };
}

const iphoneLayout: FakeItem[] = [
  ...Array.from({ length: 4 }, (_, i) => ({ id: 10 + i, hidden: true, image: { width: 512, height: 512 } })),
  { id: 26, image: { width: 2064, height: 2066, primary: true } },
  { id: 52, image: { width: 2064, height: 2066 } },
  { id: 60 }, // depth / metadata item, not an image
  { id: 61, hidden: false }, // visible non-image item (gain map, depth), as iPhone files carry
];

describe('decodeSpatialEyes', () => {
  it('decodes both eyes, ordered by the ster group, tightly packed', async () => {
    const log: string[] = [];
    const eyes = await decodeSpatialEyes(fakeLib(iphoneLayout, log), spatialSkeleton(26, 52));
    expect(eyes.left.width).toBe(2064);
    expect(eyes.left.rgba.length).toBe(2064 * 2066 * 4);
    expect(eyes.left.rgba[0]).toBe(26);
    expect(eyes.right.rgba[eyes.right.rgba.length - 1]).toBe(52);
    expect(eyes.info).toMatchObject({ items: 8, hiddenItems: 4, stereoGroup: [26, 52] });
    expect(eyes.info.visibleImages.map((v) => v.id)).toEqual([26, 52]);
    // Every handle, both images and the context are released.
    expect(log).toEqual(expect.arrayContaining(['release-handle-26', 'release-handle-52', 'release-image-26', 'release-image-52', 'free-ctx']));
  });

  it('trusts the ster order over the primary flag', async () => {
    const eyes = await decodeSpatialEyes(fakeLib(iphoneLayout), spatialSkeleton(52, 26));
    expect(eyes.left.rgba[0]).toBe(52);
    expect(eyes.right.rgba[0]).toBe(26);
  });

  it('falls back to primary + same-size sibling when there is no group', async () => {
    const eyes = await decodeSpatialEyes(fakeLib(iphoneLayout), plainSkeleton());
    expect(eyes.info.stereoGroup).toBeNull();
    expect(eyes.left.rgba[0]).toBe(26);
    expect(eyes.right.rgba[0]).toBe(52);
  });

  it('rejects a single-image HEIC and a helper image of another size', async () => {
    const single: FakeItem[] = [
      { id: 1, image: { width: 4032, height: 3024, primary: true } },
      { id: 2, image: { width: 320, height: 240 } }, // thumbnail-sized, visible
    ];
    await expect(decodeSpatialEyes(fakeLib(single), plainSkeleton())).rejects.toMatchObject({ reason: 'single-image' });
  });

  it('rejects non-HEIF bytes before touching the decoder', async () => {
    const lib = fakeLib(iphoneLayout);
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1]);
    await expect(decodeSpatialEyes(lib, jpeg)).rejects.toBeInstanceOf(SpatialDecodeError);
    await expect(decodeSpatialEyes(lib, jpeg)).rejects.toMatchObject({ reason: 'not-heif' });
  });

  it('releases the context when decoding fails', async () => {
    const log: string[] = [];
    const lib = fakeLib(iphoneLayout, log);
    lib.heif_js_decode_image2 = async () => ({ code: { value: 5 }, message: 'bitstream error' });
    await expect(decodeSpatialEyes(lib, spatialSkeleton(26, 52))).rejects.toMatchObject({ reason: 'decode-failed' });
    expect(log).toContain('free-ctx');
  });
});
