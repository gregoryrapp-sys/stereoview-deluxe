import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Loader2,
  X,
  Share2,
} from 'lucide-react';
import type { Photo } from '@/data/photos';
import { useStereoGestures } from '@/hooks/useStereoGestures';
import { useProcessedImage, usePreloadImages } from '@/hooks/useProcessedImage';
import { useTransformSettle } from '@/hooks/useTransformSettle';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { loadStereoSourceImage, resolveAlignment } from '@/lib/imageProcessing';
import { isLiveDropboxAlbum } from '@/lib/albumSource';
import {
  alignmentsEqual,
  MANUAL_ALIGN_VERSION,
  type StereoAlignment,
  toggleSwapped,
} from '@/lib/stereoAlign/types';
import type { AlignmentEstimate } from '@/lib/stereoAlign/estimator';
import {
  applyEstimate,
  AUTO_PERSIST_MIN_CONFIDENCE,
  estimateImageAlignment,
  STORE_MIN_CONFIDENCE,
} from '@/lib/stereoAlign/estimateForImage';
import { type GalleryPhoto, updatePhotoAlignment } from '@/services/galleryService';
import type { AlbumRecord } from '@/types/database';

interface SmartViewerProps {
  photo: Photo;
  photos: Photo[];
  photoIndex: number;
  album:
    | (Pick<AlbumRecord, 'source_type' | 'dropbox_folder_url'> & { import_state?: AlbumRecord['import_state'] })
    | null;
  onClose: () => void;
  onPrevious: () => void;
  onNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  /** Owner or admin: enables Align mode, whose result is saved to the photo row. */
  canEdit?: boolean;
  /** Called after an alignment is saved so the page can patch its photo list in place. */
  onAlignmentSaved?: (photoId: string, alignment: StereoAlignment) => void;
}

type ViewMode = 'stereo' | '2d';

/** Extension for a shared attachment, derived from the blob rather than the filename. */
const SHARE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Nudge step in source pixels; Shift multiplies it. */
const NUDGE_STEP = 1;
const NUDGE_STEP_LARGE = 5;

export default function SmartViewer({
  photo,
  photos,
  photoIndex,
  album,
  onClose,
  onPrevious,
  onNext,
  hasPrevious,
  hasNext,
  canEdit = false,
  onAlignmentSaved,
}: SmartViewerProps) {
  const [mode, setMode] = useState<ViewMode>('stereo');
  const [showControls, setShowControls] = useState(true);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // --- Alignment state -------------------------------------------------------
  //
  // Three layers, in order of precedence:
  //   draft      uncommitted dx/dy nudges in Align mode, previewed with CSS
  //   override   the owner's uncommitted flip in Align mode (re-splits)
  //   stored     what the photo row carries, resolved against the album default
  //
  // Visitors have no alignment controls at all: left/right order and offsets
  // are decided when a photo is measured, not per viewer - the viewing
  // experience stays simple. Only the committed layer (override ?? stored) is
  // fed to the split, so a nudge never re-encodes; the draft delta is rendered
  // as a translate on the right stage and becomes real pixels only on Save.
  const storedAlignment = resolveAlignment(photo);
  const [ownerOverride, setOwnerOverride] = useState<StereoAlignment | null>(null);
  const committedAlignment = ownerOverride ?? storedAlignment;
  const [alignMode, setAlignMode] = useState(false);
  const [draft, setDraft] = useState<{ dx: number; dy: number } | null>(null);
  const [isSavingAlignment, setIsSavingAlignment] = useState(false);

  // Estimator state: the last measurement for this photo, a transient note
  // ("Auto-aligned ..."), and whether the swap suggestion was waved away.
  const [estimate, setEstimate] = useState<AlignmentEstimate | null>(null);
  const [isEstimating, setIsEstimating] = useState(false);
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const lazyAttemptedRef = useRef<Set<string>>(new Set());
  const folderUrl = isLiveDropboxAlbum(album) ? album?.dropbox_folder_url ?? undefined : undefined;
  const galleryPhoto = photo as GalleryPhoto;

  const effectiveAlignment: StereoAlignment = {
    ...committedAlignment,
    dx: draft?.dx ?? committedAlignment.dx,
    dy: draft?.dy ?? committedAlignment.dy,
  };

  // --- Common Hooks ---
  // 2D mode renders the left eye only, so the right one is never worth decoding
  // or encoding. That is the dominant path on phones, where the viewer opens in
  // portrait, and it halves the per-photo work there.
  const eyes = mode === '2d' ? 'left' : 'both';
  const { leftUrl, rightUrl, isLoading, error, dimensions, sourceScale } = useProcessedImage(photo, album, {
    eyes,
    alignment: committedAlignment,
  });

  const adjacentPhotos = useMemo(() => {
    const result: Photo[] = [];
    if (photoIndex > 0) result.push(photos[photoIndex - 1]);
    if (photoIndex < photos.length - 1) result.push(photos[photoIndex + 1]);
    return result;
  }, [photoIndex, photos]);

  usePreloadImages(adjacentPhotos, album, { eyes });

  // --- Mode Switching Logic ---
  useEffect(() => {
    const handleResize = () => {
      setMode(window.innerHeight > window.innerWidth ? '2d' : 'stereo');
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, []);

  // --- 2D Viewer Logic ---
  const touchStartX_2d = useRef(0);
  const touchStartY_2d = useRef(0);

  const handleTouchStart_2d = (event: React.TouchEvent) => {
    touchStartX_2d.current = event.touches[0].clientX;
    touchStartY_2d.current = event.touches[0].clientY;
  };

  const handleTouchEnd_2d = (event: React.TouchEvent) => {
    const touchEndX = event.changedTouches[0].clientX;
    const touchEndY = event.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX_2d.current;
    const deltaY = touchEndY - touchStartY_2d.current;
    const threshold = 50;

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
      if (deltaX < 0 && hasNext) onNext();
      else if (deltaX > 0 && hasPrevious) onPrevious();
    }

    if (deltaY > 100 && Math.abs(deltaY) > Math.abs(deltaX)) {
      onClose();
    }
  };

  // --- Stereo Viewer Logic ---
  useEffect(() => {
    const updateSize = () => setContainerSize({ width: window.innerWidth, height: window.innerHeight });
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  // Navigate immediately. This used to defer behind a 150ms timer to play
  // `animate-slide-left/right`, but those classes are not defined anywhere -
  // it was latency for no animation, and it let two quick swipes resolve
  // against the same photo index.
  const lastSwipeAtRef = useRef(0);

  const handleSwipeLeft = useCallback(() => {
    lastSwipeAtRef.current = Date.now();
    onNext();
  }, [onNext]);

  const handleSwipeRight = useCallback(() => {
    lastSwipeAtRef.current = Date.now();
    onPrevious();
  }, [onPrevious]);

  const {
    scale,
    translateX,
    translateY,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel,
    resetTransform,
  } = useStereoGestures(handleSwipeLeft, handleSwipeRight, containerSize.width, containerSize.height, false);

  useEffect(() => {
    resetTransform();
    setShowControls(true);
    // A new photo means a new alignment; leave Align mode rather than carry a
    // draft across photos.
    setAlignMode(false);
    setDraft(null);
    setOwnerOverride(null);
    setEstimate(null);
    setAutoNote(null);
  }, [photo.id, resetTransform]);

  useEffect(() => {
    if (!autoNote) return;
    const timer = window.setTimeout(() => setAutoNote(null), 4000);
    return () => window.clearTimeout(timer);
  }, [autoNote]);

  const handleContainerClick = () => {
    if (alignMode) return;
    if (mode === 'stereo' && scale > 1) return;
    // A swipe also produces a click. Without this guard every swipe toggles the
    // controls off, so the arrows end up pointer-events-none right when the
    // user reaches for them.
    if (Date.now() - lastSwipeAtRef.current < 300) return;
    setShowControls((current) => !current);
  };

  // --- Alignment actions -----------------------------------------------------
  /** Owner, Align mode only: exchange the halves. Persisted on Save. */
  const flipEyes = useCallback(() => {
    // Per the convention, exchanging the halves negates the offsets. This is a
    // committed change (it re-splits) rather than a CSS preview, because the
    // draft's frame of reference would flip underneath it.
    setDraft(null);
    setOwnerOverride(toggleSwapped(effectiveAlignment));
  }, [effectiveAlignment]);

  const nudge = useCallback(
    (dx: number, dy: number) => {
      setDraft((current) => ({
        dx: (current?.dx ?? committedAlignment.dx) + dx,
        dy: (current?.dy ?? committedAlignment.dy) + dy,
      }));
    },
    [committedAlignment.dx, committedAlignment.dy],
  );

  const resetDraft = useCallback(() => setDraft({ dx: 0, dy: 0 }), []);

  const exitAlignMode = useCallback(() => {
    setAlignMode(false);
    setDraft(null);
  }, []);

  const saveAlignment = useCallback(async () => {
    if (!canEdit || isSavingAlignment) return;
    const next = effectiveAlignment;
    if (alignmentsEqual(next, storedAlignment)) {
      exitAlignMode();
      return;
    }
    setIsSavingAlignment(true);
    try {
      await updatePhotoAlignment({ photoId: photo.id, alignment: next, version: MANUAL_ALIGN_VERSION });
      // The stored layer now matches; drop the session override so a later
      // parent patch is the single source of truth.
      setOwnerOverride(null);
      onAlignmentSaved?.(photo.id, next);
      toast({ title: 'Alignment saved' });
      exitAlignMode();
    } catch (err) {
      toast({
        title: 'Could not save alignment',
        description: err instanceof Error ? err.message : 'Save failed',
        variant: 'destructive',
      });
    } finally {
      setIsSavingAlignment(false);
    }
  }, [canEdit, isSavingAlignment, effectiveAlignment, storedAlignment, photo.id, onAlignmentSaved, exitAlignMode]);

  // --- Estimator -------------------------------------------------------------
  const runEstimate = useCallback(
    async (swapped: boolean): Promise<AlignmentEstimate | null> => {
      setIsEstimating(true);
      try {
        const img = await loadStereoSourceImage(galleryPhoto, folderUrl);
        const est = await estimateImageAlignment(img, { swapped });
        setEstimate(est);
        return est;
      } catch (err) {
        toast({
          title: 'Could not measure alignment',
          description: err instanceof Error ? err.message : 'Estimator failed',
          variant: 'destructive',
        });
        return null;
      } finally {
        setIsEstimating(false);
      }
    },
    [galleryPhoto, folderUrl],
  );

  /** The Auto button: measure, then stage the result as a draft for the owner to judge. */
  const autoAlign = useCallback(async () => {
    const est = await runEstimate(committedAlignment.swapped);
    if (!est) return;
    if (est.confidence < STORE_MIN_CONFIDENCE) {
      toast({
        title: 'Not confident enough to align this one',
        description: 'Not enough matching detail between the eyes. Adjust by hand instead.',
      });
      return;
    }
    // The verdict may flip the halves; a flip is committed (re-split) and the
    // offsets are already expressed in the new order.
    const next = applyEstimate(est, committedAlignment.swapped);
    if (next.swapped !== committedAlignment.swapped) {
      setDraft(null);
      setOwnerOverride(next);
      toast({ title: 'Left and right were exchanged', description: 'The photo was stored right-eye first. Save to keep it.' });
    } else {
      setDraft({ dx: next.dx, dy: next.dy });
    }
    if (est.rotationSuspected) {
      toast({
        title: 'Rotation detected',
        description: 'The eyes differ by a small rotation, which a vertical shift cannot fully fix.',
      });
    }
  }, [runEstimate, committedAlignment.swapped, effectiveAlignment.dx]);

  // Lazy path for the owner: a photo with nothing stored is measured once when
  // viewed and, when the estimator is confident, saved silently - so the album
  // aligns itself as the photographer looks through it. Swap is never applied
  // here; only suggested. Skipped while a session swap is active, because the
  // displayed order would not be the stored one.
  useEffect(() => {
    if (!canEdit || folderUrl || alignMode) return;
    if (galleryPhoto.alignVersion !== null || !leftUrl) return;
    if (ownerOverride) return;
    if (lazyAttemptedRef.current.has(photo.id)) return;
    lazyAttemptedRef.current.add(photo.id);

    let cancelled = false;
    (async () => {
      try {
        const img = await loadStereoSourceImage(galleryPhoto, folderUrl);
        const est = await estimateImageAlignment(img, { swapped: storedAlignment.swapped });
        if (cancelled) return;
        setEstimate(est);
        if (est.confidence < AUTO_PERSIST_MIN_CONFIDENCE) return;
        const next = applyEstimate(est, storedAlignment.swapped);
        await updatePhotoAlignment({ photoId: photo.id, alignment: next, version: est.version, confidence: est.confidence });
        if (cancelled) return;
        onAlignmentSaved?.(photo.id, next);
        const flipped = next.swapped !== storedAlignment.swapped;
        setAutoNote(
          flipped
            ? 'Auto-aligned and flipped L/R'
            : next.dy === 0 && next.dx === 0
              ? 'Checked: already aligned'
              : `Auto-aligned (vertical ${next.dy > 0 ? '+' : ''}${next.dy} px)`,
        );
      } catch {
        // Best effort; the owner can always press Auto.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canEdit, folderUrl, alignMode, galleryPhoto, leftUrl, ownerOverride, photo.id, storedAlignment.dx, storedAlignment.swapped, onAlignmentSaved]);

  // Keyboard navigation. Desktop fullscreen is landscape, so it renders the
  // stereo view, where there is no other pointer affordance for paging. In
  // Align mode the arrows nudge instead, and Escape leaves the mode before it
  // would ever close the viewer.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (alignMode) {
        const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
        if (event.key === 'ArrowLeft') nudge(-step, 0);
        else if (event.key === 'ArrowRight') nudge(step, 0);
        else if (event.key === 'ArrowUp') nudge(0, -step);
        else if (event.key === 'ArrowDown') nudge(0, step);
        else if (event.key === 's' || event.key === 'S') flipEyes();
        else if (event.key === 'Enter') void saveAlignment();
        else if (event.key === 'Escape') exitAlignMode();
        else return;
        event.preventDefault();
        return;
      }

      if (event.key === 'ArrowLeft') {
        if (hasPrevious) onPrevious();
      } else if (event.key === 'ArrowRight') {
        if (hasNext) onNext();
      } else if (event.key === 'Escape') {
        onClose();
      } else {
        return;
      }
      event.preventDefault();
      setShowControls(true);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [alignMode, nudge, flipEyes, saveAlignment, exitAlignMode, hasPrevious, hasNext, onPrevious, onNext, onClose]);

  const viewportWidth = containerSize.width / 2;
  const viewportHeight = containerSize.height;
  const containedImageScale = dimensions ? Math.min(viewportWidth / dimensions.width, viewportHeight / dimensions.height) : 1;
  const imageStageSize = dimensions ? { width: dimensions.width * containedImageScale, height: dimensions.height * containedImageScale } : null;
  // A 3D transform plus will-change parks the stage on its own GPU layer, which
  // is what makes the gesture smooth. That layer is rasterized once and then
  // stretched, so holding it after the gesture leaves the image blurry while
  // zoomed. Once the transform settles, fall back to a 2D transform with no
  // hint and let the browser re-rasterize at the zoomed resolution.
  const isTransforming = useTransformSettle(`${scale}:${translateX}:${translateY}`);
  const imageTransform = isTransforming
    ? `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`
    : `translate(${translateX}px, ${translateY}px) scale(${scale})`;

  // CSS px per SOURCE px of one eye, at the current zoom: how far the right
  // stage must move on screen for a one-pixel nudge in the source.
  const cssPerSourcePx = containedImageScale * (sourceScale ?? 1) * scale;
  // Sampling the right eye +dx further right moves its content LEFT on screen.
  const previewDx = draft ? -(draft.dx - committedAlignment.dx) * cssPerSourcePx : 0;
  const previewDy = draft ? -(draft.dy - committedAlignment.dy) * cssPerSourcePx : 0;
  const rightTransform = draft ? `${imageTransform} translate(${previewDx}px, ${previewDy}px)` : imageTransform;

  // --- Align-mode drag -------------------------------------------------------
  // One finger (or the mouse) drags the right eye over the left. Gestures are
  // off in this mode, so zoom first, then align.
  const dragRef = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);

  const handleAlignPointerDown = (event: React.PointerEvent) => {
    if (!alignMode) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, dx: effectiveAlignment.dx, dy: effectiveAlignment.dy };
  };

  const handleAlignPointerMove = (event: React.PointerEvent) => {
    const start = dragRef.current;
    if (!alignMode || !start || cssPerSourcePx <= 0) return;
    // Dragging the right eye to the right on screen means its content should
    // come from further LEFT in the source, i.e. dx decreases.
    setDraft({
      dx: Math.round(start.dx - (event.clientX - start.x) / cssPerSourcePx),
      dy: Math.round(start.dy - (event.clientY - start.y) / cssPerSourcePx),
    });
  };

  const handleAlignPointerUp = () => {
    dragRef.current = null;
  };

  const handleShare = useCallback(async () => {
    if (!leftUrl) return;
    try {
      const res = await fetch(leftUrl);
      const blob = await res.blob();

      // Name the attachment generically. `photo.alt` is the source filename
      // (DSC-1234.jpg), which recipients have no reason to see, and it was also
      // being passed as the share sheet title. On Dropbox albums `alt` already
      // carries an extension, so appending `photo.extension` on top produced
      // "DSC-1234.jpg.jpg" - taking the extension from the blob's own MIME type
      // removes the filename and that double extension in one go.
      const mimeType = blob.type || 'image/jpeg';
      const file = new File([blob], `photo.${SHARE_EXTENSIONS[mimeType] ?? 'jpg'}`, {
        type: mimeType,
      });

      const shareApi = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };

      if (shareApi.canShare?.({ files: [file] })) {
        await shareApi.share?.({ files: [file] });
        return;
      }

      // Without file-share support, fall back to the page. The previous fallback
      // shared `leftUrl`, which is a multi-megabyte data: URL that no recipient
      // can open.
      if (shareApi.share) {
        await shareApi.share({ url: window.location.href });
      }
    } catch (e) {
      // AbortError just means the user dismissed the share sheet.
      if ((e as Error)?.name !== 'AbortError') {
        console.warn('Share failed', e);
      }
    }
  }, [leftUrl]);

  // --- Common UI Elements ---
  const controlVisibility = showControls || alignMode ? 'opacity-100' : 'pointer-events-none opacity-0';
  const roundButton = 'rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200';

  const closeButton = (
    <button
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      className={cn('absolute right-4 top-4', roundButton, controlVisibility)}
      aria-label="Close"
    >
      <X className="h-6 w-6" />
    </button>
  );

  const shareButton = (
    <button
      onClick={(e) => { e.stopPropagation(); handleShare(); }}
      className={cn('absolute left-4 top-4', roundButton, controlVisibility)}
      aria-label="Share"
    >
      <Share2 className="h-6 w-6" />
    </button>
  );

  const loadingIndicator = isLoading && (
    <div className="absolute inset-0 flex items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-white/60" />
    </div>
  );

  const errorIndicator = error && (
    <div className="absolute inset-0 flex items-center justify-center">
      <p className="px-4 text-center text-red-400">{error}</p>
    </div>
  );

  const prevButton = hasPrevious && !alignMode && (
    <button
      onClick={(e) => { e.stopPropagation(); onPrevious(); }}
      className={cn('absolute bottom-4 left-4 [padding-bottom:env(safe-area-inset-bottom)]', roundButton, controlVisibility)}
      aria-label="Previous photo"
    >
      <ChevronLeft className="h-6 w-6" />
    </button>
  );

  const nextButton = hasNext && !alignMode && (
    <button
      onClick={(e) => { e.stopPropagation(); onNext(); }}
      className={cn('absolute bottom-4 right-4 [padding-bottom:env(safe-area-inset-bottom)]', roundButton, controlVisibility)}
      aria-label="Next photo"
    >
      <ChevronRight className="h-6 w-6" />
    </button>
  );

  // Top-centre: Align for the owner only. Visitors get no alignment controls.
  const alignmentButtons = canEdit && (
    <div className={cn('absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-2 transition-opacity duration-200', controlVisibility)}>
      {!alignMode && (
        <button
          onClick={(e) => { e.stopPropagation(); setAlignMode(true); setDraft(null); }}
          className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-2 text-xs font-medium text-white backdrop-blur-sm"
          title="Adjust vertical / horizontal alignment"
        >
          <Crosshair className="h-4 w-4" />
          Align
        </button>
      )}
    </div>
  );

  const nudgeButton = (label: string, icon: React.ReactNode, dx: number, dy: number) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); nudge(e.shiftKey ? dx * NUDGE_STEP_LARGE : dx, e.shiftKey ? dy * NUDGE_STEP_LARGE : dy); }}
      className="rounded-md bg-white/15 p-2 text-white hover:bg-white/25"
      aria-label={label}
      title={`${label} (Shift: x${NUDGE_STEP_LARGE})`}
    >
      {icon}
    </button>
  );

  const alignToolbar = alignMode && (
    <div
      className="absolute inset-x-4 bottom-4 flex flex-wrap items-center justify-center gap-3 rounded-2xl bg-black/70 p-3 text-white backdrop-blur-sm [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-1">
        <span className="mr-1 text-xs text-white/70">Vertical</span>
        {nudgeButton('Move right eye up', <ArrowUp className="h-4 w-4" />, 0, -NUDGE_STEP)}
        {nudgeButton('Move right eye down', <ArrowDown className="h-4 w-4" />, 0, NUDGE_STEP)}
        <span className="w-12 text-center font-mono text-xs">{effectiveAlignment.dy}px</span>
      </div>
      <div className="flex items-center gap-1">
        <span className="mr-1 text-xs text-white/70">Convergence</span>
        {nudgeButton('Shift right eye left', <ArrowLeft className="h-4 w-4" />, -NUDGE_STEP, 0)}
        {nudgeButton('Shift right eye right', <ArrowRight className="h-4 w-4" />, NUDGE_STEP, 0)}
        <span className="w-12 text-center font-mono text-xs">{effectiveAlignment.dx}px</span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void autoAlign()}
          disabled={isEstimating}
          className="rounded-md bg-white/15 px-3 py-2 text-xs hover:bg-white/25 disabled:opacity-60"
          title="Measure the vertical offset automatically"
        >
          {isEstimating ? 'Measuring...' : 'Auto'}
        </button>
        <button
          type="button"
          onClick={flipEyes}
          className={cn('flex items-center gap-1 rounded-md px-3 py-2 text-xs hover:bg-white/25', effectiveAlignment.swapped ? 'bg-sky-500/60' : 'bg-white/15')}
          title="Exchange left and right eyes (S)"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
          Flip L/R
        </button>
        <button type="button" onClick={resetDraft} className="rounded-md bg-white/15 px-3 py-2 text-xs hover:bg-white/25">
          Reset
        </button>
        <button type="button" onClick={exitAlignMode} className="rounded-md bg-white/15 px-3 py-2 text-xs hover:bg-white/25">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void saveAlignment()}
          disabled={isSavingAlignment}
          className="rounded-md bg-sky-500/80 px-3 py-2 text-xs font-medium hover:bg-sky-500 disabled:opacity-60"
        >
          {isSavingAlignment ? 'Saving...' : 'Save'}
        </button>
      </div>
      <p className="basis-full text-center text-[11px] text-white/60">
        Drag to move the right eye over the left. Zoom in before aligning; arrow keys nudge, Shift for x5, Enter saves.
        {estimate && (
          <span className="block">
            Measured: {Math.round(estimate.confidence * 100)}% confidence
            {estimate.rotationSuspected && ' · rotation detected, shift alone cannot fully fix it'}
            {estimate.swapSuggested && ' · the eyes looked exchanged'}
          </span>
        )}
      </p>
    </div>
  );

  // Transient notes: what the lazy estimator did, and the swap suggestion.
  const estimatorChips = (
    <div className="pointer-events-none absolute left-1/2 top-16 flex -translate-x-1/2 flex-col items-center gap-2">
      {autoNote && (
        <span className="rounded-full bg-emerald-500/70 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {autoNote}
        </span>
      )}
    </div>
  );

  // --- Render Logic ---
  if (mode === '2d') {
    return (
      <div
        className="viewer-container flex h-full w-full items-center justify-center bg-black"
        onTouchStart={handleTouchStart_2d}
        onTouchEnd={handleTouchEnd_2d}
        onClick={handleContainerClick}
      >
        {loadingIndicator}
        {errorIndicator}
        {leftUrl && <img src={leftUrl} alt={photo.alt} className="max-h-full max-w-full object-contain" draggable={false} />}
        {closeButton}
        {shareButton}
        {prevButton}
        {nextButton}
      </div>
    );
  }

  // Stereo Mode
  return (
    <div
      className={cn('viewer-container h-full w-full flex items-center justify-center bg-black', alignMode && 'cursor-move touch-none')}
      onTouchStart={alignMode ? undefined : handleTouchStart}
      onTouchMove={alignMode ? undefined : handleTouchMove}
      onTouchEnd={alignMode ? undefined : handleTouchEnd}
      onTouchCancel={alignMode ? undefined : handleTouchCancel}
      onPointerDown={alignMode ? handleAlignPointerDown : undefined}
      onPointerMove={alignMode ? handleAlignPointerMove : undefined}
      onPointerUp={alignMode ? handleAlignPointerUp : undefined}
      onPointerCancel={alignMode ? handleAlignPointerUp : undefined}
      onClick={handleContainerClick}
    >
      {loadingIndicator}
      {errorIndicator}
      {leftUrl && rightUrl && (
        <div className="flex h-full w-full">
          <div className="flex h-full w-1/2 items-center justify-center overflow-hidden">
            <div className="viewer-stage" style={{ width: imageStageSize?.width, height: imageStageSize?.height, transform: imageTransform, willChange: isTransforming ? 'transform' : 'auto' }}>
              <img src={leftUrl} alt={`${photo.alt} (left)`} className="h-full w-full" draggable={false} />
            </div>
          </div>
          <div className="flex h-full w-1/2 items-center justify-center overflow-hidden">
            {/* The draft delta lives only here: the right eye moves on screen so
                the owner can judge the nudge without re-encoding anything. */}
            <div className="viewer-stage" style={{ width: imageStageSize?.width, height: imageStageSize?.height, transform: rightTransform, willChange: isTransforming || !!draft ? 'transform' : 'auto' }}>
              <img src={rightUrl} alt={`${photo.alt} (right)`} className="h-full w-full" draggable={false} />
            </div>
          </div>
        </div>
      )}
      {closeButton}
      {shareButton}
      {alignmentButtons}
      {estimatorChips}
      {prevButton}
      {nextButton}
      {alignToolbar}
      {!alignMode && Math.abs(scale - 1) > 0.01 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-secondary/60 px-3 py-1 text-sm text-muted-foreground backdrop-blur-sm">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}
