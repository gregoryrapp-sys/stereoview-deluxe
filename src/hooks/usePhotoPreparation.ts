import { useCallback, useEffect, useRef, useState } from 'react';
import { makeSbsThumbnail } from '@/lib/makeThumbnail';
import { applyEstimate, estimateFileAlignment, STORE_MIN_CONFIDENCE } from '@/lib/stereoAlign/estimateForImage';
import type { StereoAlignment } from '@/lib/stereoAlign/types';
import {
  finishPhotoPreparation,
  type GalleryPhoto,
  signedOriginalUrl,
  uploadThumbnail,
} from '@/services/galleryService';
import type { AlbumRecord } from '@/types/database';

/**
 * Prepares photos in the background while the owner is on the management page.
 *
 * "Prepared" means: has a grid thumbnail, and has been measured for alignment
 * and left/right order. Both used to be buttons the owner had to remember;
 * 136 photos sat unprepared for days because nobody pressed them. Now it just
 * happens - a couple at a time, quietly, resuming where it left off.
 *
 * Each photo costs one download of its original (~1.1 MB). The thumbnail and
 * the measurement are made from the same bytes, then written in one row
 * update, so a photo is never half-prepared for longer than one request.
 * Pauses while the tab is hidden; failures are counted and not retried in the
 * same session.
 */

const CONCURRENCY = 2;

export interface PreparationProgress {
  /** Photos that needed work when this session started (grows if new ones appear). */
  total: number;
  done: number;
  failed: number;
  paused: boolean;
  active: boolean;
}

interface Options {
  enabled: boolean;
  /** Called with the finished photo so the page can patch its list in place. */
  onPrepared: (photoId: string, patch: Partial<GalleryPhoto>) => void;
}

export function needsPreparation(photo: GalleryPhoto, album: AlbumRecord | undefined): boolean {
  if (!photo.storagePath || !album) return false;
  // Live Dropbox photos have no stored original to work from.
  if (album.source_type === 'dropbox' && album.import_state !== 'imported') return false;
  return !photo.thumbPath || photo.alignVersion === null || photo.alignVersion === undefined;
}

export function usePhotoPreparation(
  photos: GalleryPhoto[],
  albums: AlbumRecord[],
  { enabled, onPrepared }: Options,
): PreparationProgress & { pause: () => void; resume: () => void } {
  const [progress, setProgress] = useState<PreparationProgress>({ total: 0, done: 0, failed: 0, paused: false, active: false });
  const [userPaused, setUserPaused] = useState(false);
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden');

  // Everything the loop needs is read through refs so the effect does not
  // restart (and re-plan) every time the gallery re-renders.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const albumsRef = useRef(albums);
  albumsRef.current = albums;
  const onPreparedRef = useRef(onPrepared);
  onPreparedRef.current = onPrepared;

  const attempted = useRef<Set<string>>(new Set());
  const running = useRef(false);

  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const paused = userPaused || hidden;

  // A cheap identity of "which photos still need work", so the loop restarts
  // only when the set changes - e.g. after an upload - not on every render.
  const pendingKey = photos
    .filter((p) => needsPreparation(p, albums.find((a) => a.id === p.albumId)) && !attempted.current.has(p.id))
    .map((p) => p.id)
    .join(',');

  useEffect(() => {
    if (!enabled || paused || running.current || !pendingKey) return;

    const albumById = new Map(albumsRef.current.map((a) => [a.id, a]));
    const queue = photosRef.current.filter(
      (p) => needsPreparation(p, albumById.get(p.albumId ?? '')) && !attempted.current.has(p.id),
    );
    if (queue.length === 0) return;

    running.current = true;
    let cancelled = false;
    setProgress((current) => ({ ...current, total: current.done + current.failed + queue.length, active: true, paused: false }));

    let cursor = 0;
    const worker = async () => {
      while (cursor < queue.length && !cancelled) {
        const photo = queue[cursor++];
        attempted.current.add(photo.id);
        try {
          const album = albumById.get(photo.albumId ?? '');
          const url = await signedOriginalUrl(photo.storagePath!);
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();

          // Thumbnail (if missing) and measurement (if never done), from one download.
          const thumbPath = photo.thumbPath
            ? photo.thumbPath
            : await makeSbsThumbnail(blob)
                .then((thumb) => uploadThumbnail(photo.storagePath!, thumb))
                .catch(() => null);

          const needsAlignment = photo.alignVersion === null || photo.alignVersion === undefined;
          const displayedSwapped = photo.alignment?.swapped ?? !!album?.lr_swapped_default;
          let alignment: StereoAlignment | null = null;
          let version: number | null = null;
          let confidence: number | null = null;
          if (needsAlignment) {
            const est = await estimateFileAlignment(blob, { swapped: displayedSwapped }).catch(() => null);
            if (est) {
              version = est.version;
              confidence = est.confidence;
              // Unsure: record that it was measured (so it is not measured again
              // on every visit) with identity offsets and the order as uploaded.
              alignment =
                est.confidence >= STORE_MIN_CONFIDENCE
                  ? applyEstimate(est, displayedSwapped)
                  : { dx: 0, dy: 0, swapped: displayedSwapped };
            }
          }

          await finishPhotoPreparation({ photoId: photo.id, thumbPath, alignment, version, confidence });
          if (cancelled) return;

          onPreparedRef.current(photo.id, {
            ...(thumbPath ? { thumbPath } : {}),
            ...(alignment ? { alignment, alignVersion: version, alignConfidence: confidence } : {}),
          });
          setProgress((current) => ({ ...current, done: current.done + 1 }));
        } catch (error) {
          console.warn('Photo preparation failed for', photo.id, error);
          setProgress((current) => ({ ...current, failed: current.failed + 1 }));
        }
      }
    };

    Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker)).finally(() => {
      running.current = false;
      if (!cancelled) setProgress((current) => ({ ...current, active: false }));
    });

    return () => {
      // Pausing or unmounting: stop taking new items. The one in flight
      // finishes and commits (or fails) on its own; it is already marked
      // attempted, so it is not picked up again this session.
      cancelled = true;
      running.current = false;
    };
  }, [enabled, paused, pendingKey]);

  const pause = useCallback(() => setUserPaused(true), []);
  const resume = useCallback(() => setUserPaused(false), []);

  return { ...progress, paused, pause, resume };
}
