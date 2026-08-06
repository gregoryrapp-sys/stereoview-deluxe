import type { Photo } from '@/data/photos';

interface StereoThumbnailProps {
  photo: Photo;
}

export default function StereoThumbnail({ photo }: StereoThumbnailProps) {
  // To show only the left half of a side-by-side stereo image, we use a div
  // with a background image.
  // `background-size: 200% auto` makes the background image twice the width of
  // the container, while maintaining its aspect ratio.
  // `background-position: 0% 50%` (or `left center`) ensures that only the
  // left half of the scaled background image is visible, and it's centered
  // vertically. This effectively crops the image to the left eye's view
  // while respecting the aspect ratio, similar to `object-fit: cover`.
  return (
    <div
      style={{
        backgroundImage: `url('${photo.src}')`,
        backgroundSize: '200% auto',
        backgroundPosition: '0% 50%',
      }}
      className="h-full w-full bg-no-repeat transition-opacity group-hover:opacity-90"
      role="img"
      aria-label={photo.alt}
    />
  );
}
