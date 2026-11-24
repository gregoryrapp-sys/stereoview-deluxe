import { useEffect, useState } from 'react';
import { Film, Play } from 'lucide-react';
import type { Photo } from '@/data/photos';
import { isVideoPhoto } from '@/lib/media';
import { cn } from '@/lib/utils';
import { eyeRatioOf, fitBox } from '@/lib/thumbnailFit';
import { knownNaturalSize, rememberNaturalSize } from '@/hooks/useNaturalImageSize';

interface StereoThumbnailProps {
  photo: Photo & { thumbSrc?: string; storagePath?: string; alignment?: { swapped: boolean } };
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
 * The whole eye is shown, shrunk to fit the tile (letterboxed on the tile's
 * background), never cropped: a 16:9 eye in a square tile gets bars above and
 * below, a portrait eye gets bars at the sides.
 *
 * Inside the tile, a box with the eye's own aspect ratio is centred and sized
 * to fit; the <img> in it is twice that box's width, so with `object-fit:
 * cover` exactly one half of the side-by-side shows, uncropped. The eye's
 * ratio comes from the image once it loads (or from a size already seen
 * elsewhere); until then the box fills the tile.
 *
 * It loads `thumbSrc` - the ~80 KB downscaled copy - when the photo has one,
 * and only falls back to the original when there is no thumbnail or it fails
 * to load. Being a real <img> rather than a CSS background is what makes
 * `loading="lazy"` possible: tiles below the fold are not fetched at all.
 *
 * A side-by-side video shows its poster frame (stored as its thumbnail) with
 * a play badge. Without a poster it shows a film icon: the original is a
 * video file, which an <img> cannot display.
 */
export default function StereoThumbnail({ photo, swapped: swappedProp }: StereoThumbnailProps) {
  const [thumbFailed, setThumbFailed] = useState(false);
  // A pair stored right-eye-first shows its true left eye, the same one the
  // viewer displays, without regenerating any thumbnail.
  const swapped = swappedProp ?? photo.alignment?.swapped ?? false;

  // A new photo (or a re-signed URL) gets a fresh attempt at the thumbnail.
  useEffect(() => setThumbFailed(false), [photo.thumbSrc]);

  const isVideo = isVideoPhoto(photo);
  const src = photo.thumbSrc && !thumbFailed ? photo.thumbSrc : isVideo ? null : photo.src;

  // Width / height of one eye, once known.
  const [eyeRatio, setEyeRatio] = useState<number | null>(() => eyeRatioOf(src ? knownNaturalSize(src) : null));
  useEffect(() => setEyeRatio(eyeRatioOf(src ? knownNaturalSize(src) : null)), [src]);

  if (!src) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-secondary" role="img" aria-label={photo.alt}>
        <Film className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden" role="img" aria-label={photo.alt}>
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden" style={fitBox(eyeRatio)}>
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
          onLoad={(event) => {
            const { naturalWidth, naturalHeight } = event.currentTarget;
            // The viewer sizes its loading placeholder from this; a tile that
            // was on screen means the photo opens with no layout jump.
            rememberNaturalSize(src, naturalWidth, naturalHeight);
            setEyeRatio(eyeRatioOf({ width: naturalWidth, height: naturalHeight }));
          }}
          onError={() => {
            if (photo.thumbSrc && !thumbFailed) setThumbFailed(true);
          }}
        />
      </div>
      {isVideo && (
        <span className="pointer-events-none absolute bottom-1.5 left-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white">
          <Play className="h-3 w-3 fill-current" />
        </span>
      )}
    </div>
  );
}
