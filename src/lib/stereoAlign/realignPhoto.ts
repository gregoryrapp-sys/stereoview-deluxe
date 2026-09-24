import type { GalleryPhoto } from '@/services/galleryService';
import { signedOriginalUrl, updatePhotoAlignment } from '@/services/galleryService';
import type { AlignmentEstimate } from './estimator';
import { applyEstimate, estimateFileAlignment, STORE_MIN_CONFIDENCE } from './estimateForImage';
import type { StereoAlignment } from './types';

export type RealignOutcome =
  | { status: 'saved'; alignment: StereoAlignment; estimate: AlignmentEstimate; flipped: boolean }
  | { status: 'unsure'; estimate: AlignmentEstimate };

/**
 * Re-measures one already-uploaded photo with the current estimator and saves
 * the result. Overwrites whatever was stored before, including a manual
 * alignment - the owner asked for it by name, so that is the intent.
 *
 * Measured in the photo's current displayed order (`alignment.swapped`, which
 * already reflects the album default). The left/right order is corrected when
 * the depth cue is clear; `flipped` tells the caller it happened.
 */
export async function realignPhoto(photo: GalleryPhoto): Promise<RealignOutcome> {
  if (!photo.storagePath) throw new Error('This photo has no stored original to measure.');

  const swapped = photo.alignment?.swapped ?? false;
  const url = await signedOriginalUrl(photo.storagePath);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Original could not be downloaded (HTTP ${response.status})`);

  const estimate = await estimateFileAlignment(await response.blob(), { swapped });
  if (estimate.confidence < STORE_MIN_CONFIDENCE) {
    return { status: 'unsure', estimate };
  }

  const alignment = applyEstimate(estimate, swapped);
  await updatePhotoAlignment({
    photoId: photo.id,
    alignment,
    version: estimate.version,
    confidence: estimate.confidence,
  });
  return { status: 'saved', alignment, estimate, flipped: alignment.swapped !== swapped };
}

/** One-line human summary for a toast. */
export function describeAlignment(a: StereoAlignment, confidence: number): string {
  const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);
  return `Vertical ${sign(a.dy)} px · horizontal ${sign(a.dx)} px · ${Math.round(confidence * 100)}% confidence`;
}
