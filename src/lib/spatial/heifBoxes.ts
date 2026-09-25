/**
 * HEIF container helpers that need no decoder.
 *
 * An Apple Spatial Photo is an ordinary HEIC whose two eyes are separate image
 * items joined by a `ster` entity group (`meta` → `grpl` → `ster`). The group
 * lists the left eye first. libheif's JS build does not expose entity groups,
 * so the group is read straight from the boxes here; the decoder only needs
 * the two item ids it names.
 */

const HEIF_EXTENSION = /\.(heic|heif|hif)$/i;
const HEIF_MIME = /^image\/hei[cf]/i;

/** True for files a picker or drop hands us that we should route through libheif. */
export function isHeifFile(file: { name: string; type?: string }): boolean {
  return HEIF_EXTENSION.test(file.name) || HEIF_MIME.test(file.type ?? '');
}

function fourcc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

/** Sniffs the ISO base media `ftyp` header; extension and MIME type lie more often. */
export function isHeifBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 12 && fourcc(bytes, 4) === 'ftyp';
}

/**
 * Finds the `ster` stereo-pair group and returns the item ids it lists,
 * `[left, right]`, or null when the file has none.
 */
export function findStereoGroup(bytes: Uint8Array): [number, number] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (offset: number) => view.getUint32(offset);

  const walk = (start: number, end: number, insideGrpl: boolean): [number, number] | null => {
    let offset = start;
    while (offset + 8 <= end) {
      let size = u32(offset);
      let header = 8;
      const type = fourcc(bytes, offset + 4);
      if (size === 1) {
        // 64-bit largesize; files this small never need it but the walk must not derail.
        size = Number(view.getBigUint64(offset + 8));
        header = 16;
      }
      if (size === 0) size = end - offset;
      if (size < header) return null;
      // `meta` is a FullBox (4 bytes of version/flags before its children).
      const body = offset + header + (type === 'meta' ? 4 : 0);
      if (type === 'ster' && insideGrpl) {
        // EntityToGroupBox: version/flags, group_id, num_entities_in_group, ids[]
        const count = u32(body + 8);
        if (count < 2) return null;
        return [u32(body + 12), u32(body + 16)];
      }
      if (type === 'meta' || type === 'grpl') {
        const found = walk(body, Math.min(offset + size, end), type === 'grpl');
        if (found) return found;
      }
      offset += size;
    }
    return null;
  };

  try {
    return walk(0, bytes.byteLength, false);
  } catch {
    return null;
  }
}
