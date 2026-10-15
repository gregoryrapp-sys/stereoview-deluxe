import { useEffect, useState } from 'react';

/**
 * Natural pixel size of an image URL, remembered across components.
 *
 * The viewer needs the grid thumbnail's size before the sharp eyes exist, to
 * draw the placeholder in the box the eyes will occupy. The grid tile already
 * decoded that thumbnail, so it reports the size here and the viewer reads it
 * synchronously on its first render; anything not seen yet is loaded from
 * the browser cache, which resolves within a frame.
 */

interface NaturalSize {
  width: number;
  height: number;
}

const sizes = new Map<string, NaturalSize>();

export function rememberNaturalSize(src: string | undefined, width: number, height: number): void {
  if (src && width > 0 && height > 0) sizes.set(src, { width, height });
}

export function useNaturalImageSize(src: string | undefined): NaturalSize | null {
  const [size, setSize] = useState<NaturalSize | null>(() => (src ? sizes.get(src) ?? null : null));

  useEffect(() => {
    if (!src) {
      setSize(null);
      return;
    }
    const known = sizes.get(src);
    if (known) {
      setSize(known);
      return;
    }
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      rememberNaturalSize(src, image.naturalWidth, image.naturalHeight);
      if (!cancelled) setSize(sizes.get(src) ?? null);
    };
    image.onerror = () => {
      if (!cancelled) setSize(null);
    };
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src]);

  return size;
}
