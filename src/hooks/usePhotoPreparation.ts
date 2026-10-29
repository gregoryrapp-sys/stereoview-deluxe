import { useCallback, useEffect, useRef, useState } from 'react';
import { makeSbsThumbnail } from '@/lib/makeThumbnail';
import { ALIGN_VERSION } from '@/lib/stereoAlign/estimator';
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

/**
 * Never measured, or measured by an older estimator. Manual alignments
 * (version 0) are the owner's and are kept. The queue and the worker both use
 * this one rule: when they disagreed, re-measure candidates were queued, their
 * originals downloaded, and nothing measured - on every page load.
 */
export function needsAlignmentMeasure(photo: GalleryPhoto): boolean {
  const version = photo.alignVersion;
  if (version === null || version === undefined) return true;
  return version >= 1 && version < ALIGN_VERSION;
}

export function needsPreparation(photo: GalleryPhoto, album: AlbumRecord | undefined): boolean {
  if (!photo.storagePath || !album) return false;
  // Live Dropbox photos have no stored original to work from.
  if (album.source_type === 'dropbox' && album.import_state !== 'imported') return false;
  return !photo.thumbPath || needsAlignmentMeasure(photo);
}

/** Lets the browser paint and handle input between photos. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const idle = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
    if (idle) idle(() => resolve(), { timeout: 500 });
    else setTimeout(resolve, 50);
  });
}

export function usePhotoPreparation(
  photos: GalleryPhoto[],
  albums: AlbumRecord[],
  { enabled, onPrepared }: Options,
): PreparationProgress & { pause: () => void; resume: () => void; retryFailed: () => void } {
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
  const failedIds = useRef<Set<string>>(new Set());
  /** Bumped by retryFailed so the queue effect runs again. */
  const [pass, setPass] = useState(0);
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

  // The run stops only on pause, disable or unmount. It used to be cancelled
  // and restarted every time a finished photo changed `pendingKey`, which
  // left the previous run's in-flight downloads going alongside the new one.
  const stopRef = useRef<{ stopped: boolean } | null>(null);
  useEffect(() => {
    if (enabled && !paused) return;
    if (stopRef.current) stopRef.current.stopped = true;
  }, [enabled, paused]);
  useEffect(
    () => () => {
      if (stopRef.current) stopRef.current.stopped = true;
    },
    [],
  );

  useEffect(() => {
    if (!enabled || paused || running.current || !pendingKey) return;

    // Pulled from the CURRENT list each time, so photos uploaded mid-run are
    // picked up without restarting anything.
    const next = (): GalleryPhoto | undefined => {
      const albumById = new Map(albumsRef.current.map((a) => [a.id, a]));
      return photosRef.current.find(
        (p) => needsPreparation(p, albumById.get(p.albumId ?? '')) && !attempted.current.has(p.id),
      );
    };
    if (!next()) return;

    const stop = { stopped: false };
    stopRef.current = stop;
    running.current = true;
    const remaining = () => {
      const albumById = new Map(albumsRef.current.map((a) => [a.id, a]));
      return photosRef.current.filter(
        (p) => needsPreparation(p, albumById.get(p.albumId ?? '')) && !attempted.current.has(p.id),
      ).length;
    };
    setProgress((current) => ({ ...current, total: current.done + current.failed + remaining(), active: true, paused: false }));

    const worker = async () => {
      for (let photo = next(); photo && !stop.stopped; photo = next()) {
        attempted.current.add(photo.id);
        try {
          const album = albumsRef.current.find((a) => a.id === photo!.albumId);
          const url = await signedOriginalUrl(photo.storagePath!);
          const response = await fetch(url);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();

          // Thumbnail (if missing) and measurement (if due), from one download.
          const thumbPath = photo.thumbPath
            ? photo.thumbPath
            : await makeSbsThumbnail(blob)
                .then((thumb) => uploadThumbnail(photo!.storagePath!, thumb))
                .catch((error) => {
                  // Keep going without a thumbnail, but say why.
                  console.warn('Thumbnail could not be made for', photo!.id, error);
                  return null;
                });

          const remeasure = photo.alignVersion !== null && photo.alignVersion !== undefined;
          const displayedSwapped = photo.alignment?.swapped ?? !!album?.lr_swapped_default;
          let alignment: StereoAlignment | null = null;
          let version: number | null = null;
          let confidence: number | null = null;
          if (needsAlignmentMeasure(photo)) {
            const est = await estimateFileAlignment(blob, { swapped: displayedSwapped }).catch(() => null);
            if (est) {
              version = est.version;
              confidence = est.confidence;
              // Unsure: record that it was measured (so it is not measured
              // again on every visit). A first measurement stores identity; a
              // re-measure keeps the alignment the photo already had rather
              // than replace a confident old answer with "no correction".
              alignment =
                est.confidence >= STORE_MIN_CONFIDENCE
                  ? applyEstimate(est, displayedSwapped)
                  : remeasure && photo.alignment
                    ? photo.alignment
                    : { dx: 0, dy: 0, swapped: displayedSwapped };
            }
          }

          await finishPhotoPreparation({ photoId: photo.id, thumbPath, alignment, version, confidence });

          const patch: Partial<GalleryPhoto> = {
            ...(thumbPath && thumbPath !== photo.thumbPath ? { thumbPath } : {}),
            ...(alignment ? { alignment, alignVersion: version, alignConfidence: confidence } : {}),
          };
          if (Object.keys(patch).length > 0) onPreparedRef.current(photo.id, patch);
          setProgress((current) => ({ ...current, done: current.done + 1 }));
        } catch (error) {
          console.warn('Photo preparation failed for', photo.id, error);
          failedIds.current.add(photo.id);
          setProgress((current) => ({ ...current, failed: current.failed + 1 }));
        }
        await yieldToBrowser();
      }
    };

    Promise.all(Array.from({ length: CONCURRENCY }, worker)).finally(() => {
      running.current = false;
      if (stopRef.current === stop) stopRef.current = null;
      setProgress((current) => ({ ...current, active: false }));
    });
    // No cleanup here on purpose: see stopRef above.
  }, [enabled, paused, pendingKey, pass]);

  const pause = useCallback(() => setUserPaused(true), []);
  const resume = useCallback(() => setUserPaused(false), []);

  // Failed photos are not retried in the same session (an unreachable
  // original would loop); the owner can ask for another attempt explicitly.
  const retryFailed = useCallback(() => {
    for (const id of failedIds.current) attempted.current.delete(id);
    failedIds.current.clear();
    setProgress((current) => ({ ...current, failed: 0 }));
    setPass((n) => n + 1);
  }, []);

  return { ...progress, paused, pause, resume, retryFailed };
}
