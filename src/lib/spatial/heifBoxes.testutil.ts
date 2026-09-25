/** Builds minimal ISO-BMFF boxes for tests; not a test file itself. */

function be32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}

export function box(type: string, ...payload: (number[] | Uint8Array)[]): Uint8Array {
  const body = payload.flatMap((p) => Array.from(p));
  return new Uint8Array([...be32(8 + body.length), ...type.split('').map((c) => c.charCodeAt(0)), ...body]);
}

export const fullBoxHeader = [0, 0, 0, 0];

export function ftyp(brand = 'heic'): Uint8Array {
  return box('ftyp', brand.split('').map((c) => c.charCodeAt(0)), be32(0), 'mif1'.split('').map((c) => c.charCodeAt(0)));
}

export function ster(groupId: number, ids: number[]): Uint8Array {
  return box('ster', fullBoxHeader, be32(groupId), be32(ids.length), ...ids.map(be32));
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** A HEIC skeleton: ftyp + meta(hdlr, grpl(ster)) with the given eye ids. */
export function spatialSkeleton(leftId: number, rightId: number): Uint8Array {
  const hdlr = box('hdlr', fullBoxHeader, be32(0), 'pict'.split('').map((c) => c.charCodeAt(0)), be32(0), be32(0), be32(0), [0]);
  const meta = box('meta', fullBoxHeader, hdlr, box('grpl', ster(3, [leftId, rightId])));
  return concat(ftyp(), meta, box('mdat', [1, 2, 3]));
}

export function plainSkeleton(): Uint8Array {
  const meta = box('meta', fullBoxHeader, box('hdlr', fullBoxHeader, be32(0), 'pict'.split('').map((c) => c.charCodeAt(0)), be32(0), be32(0), be32(0), [0]));
  return concat(ftyp(), meta, box('mdat', [1, 2, 3]));
}
