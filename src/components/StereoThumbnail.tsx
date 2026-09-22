import { useEffect, useState } from 'react';
import type { Photo } from '@/data/photos';
import { cn } from '@/lib/utils';

interface StereoThumbnailProps {
  photo: Photo & { thumbSrc?: string; alignment?: { swapped: boolean } };
  /**
   * Accepted for call-site compatibility (ObjectCoverPickerDialog passes it);
   * the thumbnail itself has no Dropbox-specific behaviour.
   */
  album?: unknown;
  /** Show the right half instead of the left. Defaults to the photo's resolved alignment. */
  swapped?: boolean;
}

/**
 * One eye of a side-by-side stereo image, as a grid tile.
 *
 * Renders an <img> twice the tile's width, clipped by the wrapper, so exactly
 * one half is visible: `object-fit: cover` scales the whole SBS to the 2W x H
 * box, and the left (or right) half of that box is one eye, cropped to the
 * tile's aspect. This works for 2:1, 3:2 and 4:3 tiles alike.
 *
 * It loads `thumbSrc` - the ~80 KB downscaled copy - when the photo has one,
 * and only falls back to the original when there is no thumbnail or it fails
 * to load. Being a real <img> rather than a CSS background is what makes
 * `loading="lazy"` possible: tiles below the fold are not fetched at all.
 */
export default function StereoThumbnail({ photo, swapped: swappedProp }: StereoThumbnailProps) {
  const [thumbFailed, setThumbFailed] = useState(false);
  // A pair stored right-eye-first shows its true left eye, the same one the
  // viewer displays, without regenerating any thumbnail.
  const swapped = swappedProp ?? photo.alignment?.swapped ?? false;

  // A new photo (or a re-signed URL) gets a fresh attempt at the thumbnail.
  useEffect(() => setThumbFailed(false), [photo.thumbSrc]);

  const src = photo.thumbSrc && !thumbFailed ? photo.thumbSrc : photo.src;

  return (
    <div className="relative h-full w-full overflow-hidden" role="img" aria-label={photo.alt}>
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        className={cn(
          'absolute inset-y-0 h-full w-[200%] max-w-none object-cover transition-opacity group-hover:opacity-90',
          swapped ? 'right-0 object-right' : 'left-0 object-left',
        )}
        onError={() => {
          if (photo.thumbSrc && !thumbFailed) setThumbFailed(true);
        }}
      />
    </div>
  );
}
