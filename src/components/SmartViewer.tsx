import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronLeft, ChevronRight, Loader2, X, Share2 } from 'lucide-react';
import type { Photo } from '@/data/photos';
import { isViewerControl, useStereoGestures } from '@/hooks/useStereoGestures';
import { useProcessedImage, usePreloadImages } from '@/hooks/useProcessedImage';
import { useTransformSettle } from '@/hooks/useTransformSettle';
import { useNaturalImageSize } from '@/hooks/useNaturalImageSize';
import { eyeSizeFromThumb, eyeViewport, fitContain } from '@/lib/viewerGeometry';
import { cn } from '@/lib/utils';
import ViewerSharePanel from '@/components/ViewerSharePanel';
import { toast } from '@/hooks/use-toast';
import { type EyeTier, loadStereoSourceImage, resolveAlignment, ZOOM_TIER_MIN_SCALE } from '@/lib/imageProcessing';
import { isLiveDropboxAlbum } from '@/lib/albumSource';
import type { StereoAlignment } from '@/lib/stereoAlign/types';
import { applyEstimate, AUTO_PERSIST_MIN_CONFIDENCE, estimateImageAlignment } from '@/lib/stereoAlign/estimateForImage';
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
  /** Owner or admin: an unmeasured photo is auto-aligned on first view and saved to its row. */
  canEdit?: boolean;
  /** Called after an alignment is saved so the page can patch its photo list in place. */
  onAlignmentSaved?: (photoId: string, alignment: StereoAlignment, version: number) => void;
  /**
   * Address that opens this photo for someone else. With it, Share offers
   * "photo" or "link" (URL + QR); without it (private pages), Share sends the
   * photo directly.
   */
  linkForPhoto?: (photo: Photo) => string;
}

type ViewMode = 'stereo' | '2d';

/** Extension for a shared attachment, derived from the blob rather than the filename. */
const SHARE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Nudge step in source pixels; Shift multiplies it. */
/** Controls hide this long after the last interaction. */
const CONTROLS_AUTO_HIDE_MS = 3000;
/** The sharp eyes fade in over the placeholder this fast. */
const FADE_MS = 200;
/** Loads shorter than this show no spinner at all. */
const SPINNER_DELAY_MS = 300;

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
  linkForPhoto,
}: SmartViewerProps) {
  const [mode, setMode] = useState<ViewMode>('stereo');
  const [showControls, setShowControls] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const linkUrl = linkForPhoto ? linkForPhoto(photo) : null;
  useEffect(() => setShareOpen(false), [photo.id]);
  /** Bumped by any interaction, so the auto-hide countdown starts over. */
  const [interaction, setInteraction] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // --- Alignment ---------------------------------------------------------------
  // There are no alignment controls in the viewer: left/right order and
  // offsets are decided when a photo is measured (at upload, in background
  // preparation, or here on first view for the owner), not by hand.
  const storedAlignment = resolveAlignment(photo);

  // A transient note saying what the lazy estimator did ("Auto-aligned ...").
  const [autoNote, setAutoNote] = useState<string | null>(null);
  const lazyAttemptedRef = useRef<Set<string>>(new Set());
  const folderUrl = isLiveDropboxAlbum(album) ? album?.dropbox_folder_url ?? undefined : undefined;
  const galleryPhoto = photo as GalleryPhoto;

  // --- Common Hooks ---
  // 2D mode renders the left eye only, so the right one is never worth decoding
  // or encoding. That is the dominant path on phones, where the viewer opens in
  // portrait, and it halves the per-photo work there.
  const eyes = mode === '2d' ? 'left' : 'both';

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

  // Touch taps toggle the controls through the gesture handlers (see
  // toggleControlsFromTouch); clicks are for the mouse. A tap also makes the
  // browser synthesize a click, which this guard swallows so one tap is one
  // toggle. Zoomed in, a tap still toggles: the gesture hook tells a tap from
  // a pan by distance, so the old "no toggling while zoomed" rule is gone.
  const lastTouchTapAtRef = useRef(0);
  const lastTouchAtRef = useRef(0);
  const markTouch = useCallback(() => {
    lastTouchAtRef.current = Date.now();
    setInteraction((n) => n + 1);
  }, []);

  // Controls fade out 3 s after the last interaction and come back with a tap
  // (or, with a mouse, any movement).
  useEffect(() => {
    if (!showControls || shareOpen) return;
    const timer = window.setTimeout(() => setShowControls(false), CONTROLS_AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [showControls, shareOpen, interaction]);

  const handleMouseActivity = useCallback((event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    setShowControls(true);
    setInteraction((n) => n + 1);
  }, []);
  const toggleControlsFromTouch = useCallback(() => {
    lastTouchTapAtRef.current = Date.now();
    setShowControls((current) => !current);
  }, []);

  // --- 2D Viewer Logic ---
  const touchStartX_2d = useRef(0);
  const touchStartY_2d = useRef(0);

  const touchStartAt_2d = useRef(0);
  const startedOnControl_2d = useRef(false);
  const multiTouch_2d = useRef(false);

  const handleTouchStart_2d = (event: React.TouchEvent) => {
    if (event.touches.length > 1) {
      multiTouch_2d.current = true;
      return;
    }
    multiTouch_2d.current = false;
    startedOnControl_2d.current = isViewerControl(event.target);
    touchStartX_2d.current = event.touches[0].clientX;
    touchStartY_2d.current = event.touches[0].clientY;
    touchStartAt_2d.current = Date.now();
  };

  const handleTouchEnd_2d = (event: React.TouchEvent) => {
    if (event.touches.length > 0) return; // a finger is still down
    // The control's own click does the work; a multi-finger touch is not a
    // tap or a swipe.
    if (startedOnControl_2d.current || multiTouch_2d.current) return;
    const touchEndX = event.changedTouches[0].clientX;
    const touchEndY = event.changedTouches[0].clientY;
    const deltaX = touchEndX - touchStartX_2d.current;
    const deltaY = touchEndY - touchStartY_2d.current;
    const threshold = 50;

    // A short, still touch is a tap: toggle the controls from the touch
    // path itself, anywhere in the viewer, instead of hoping the browser
    // synthesizes a click (iOS does not always, on the letterbox area).
    if (Math.hypot(deltaX, deltaY) < 10 && Date.now() - touchStartAt_2d.current < 300) {
      toggleControlsFromTouch();
      return;
    }

    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
      if (deltaX < 0 && hasNext) onNext();
      else if (deltaX > 0 && hasPrevious) onPrevious();
    }

    if (deltaY > 100 && Math.abs(deltaY) > Math.abs(deltaX)) {
      onClose();
    }
  };

  // iOS Safari treats a horizontal drag it is allowed to scroll as its own
  // (page scroll, back gesture) and cancels the touch, so the swipe never
  // ends in our handler. React registers touchmove as passive, where
  // preventDefault is ignored; a native non-passive listener keeps every
  // touch sequence ours. The viewer is fullscreen, so nothing is lost.
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const keep = (event: TouchEvent) => {
      if (event.cancelable) event.preventDefault();
    };
    el.addEventListener('touchmove', keep, { passive: false });
    return () => el.removeEventListener('touchmove', keep);
  }, [mode]);

  const handleTouchCancel_2d = () => {
    multiTouch_2d.current = false;
    startedOnControl_2d.current = false;
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
  } = useStereoGestures(handleSwipeLeft, handleSwipeRight, containerSize.width, containerSize.height, false, {
    onTap: toggleControlsFromTouch,
  });

  // Pinched past the fit tier's headroom: ask for eyes at (up to) source
  // resolution. The fit tier stays on screen until the sharper one arrives.
  const tier: EyeTier = mode === 'stereo' && scale >= ZOOM_TIER_MIN_SCALE ? 'zoom' : 'fit';
  const { leftUrl, rightUrl, isLoading, error, dimensions } = useProcessedImage(photo, album, {
    eyes,
    alignment: storedAlignment,
    tier,
  });

  useEffect(() => {
    resetTransform();
    // Opening the viewer or arriving by keyboard shows the controls; a swipe
    // does not. Someone paging through an album with the controls hidden
    // had them pop back up on every photo, which is exactly when they are in
    // the way.
    if (Date.now() - lastSwipeAtRef.current > 500) setShowControls(true);
    setAutoNote(null);
  }, [photo.id, resetTransform]);

  useEffect(() => {
    if (!autoNote) return;
    const timer = window.setTimeout(() => setAutoNote(null), 4000);
    return () => window.clearTimeout(timer);
  }, [autoNote]);

  const handleContainerClick = () => {
    // Any recent touch: this click is the browser's echo of it. The touch path
    // already handled (or deliberately ignored) the gesture. Keyed on the
    // touch itself, not on when the tap fired - the tap is deferred 300 ms
    // for double-tap detection, so the echo arrived first and toggled the
    // controls, and the tap then toggled them straight back.
    if (Date.now() - lastTouchTapAtRef.current < 700) return;
    if (Date.now() - lastTouchAtRef.current < 800) return;
    // A swipe also produces a click. Without this guard every swipe toggles the
    // controls off, so the arrows end up pointer-events-none right when the
    // user reaches for them.
    if (Date.now() - lastSwipeAtRef.current < 300) return;
    setShowControls((current) => !current);
  };

  // Lazy path for the owner: a photo with nothing stored is measured once when
  // viewed and, when the estimator is confident, saved silently - so the album
  // aligns itself as the photographer looks through it.
  useEffect(() => {
    if (!canEdit || folderUrl) return;
    if (galleryPhoto.alignVersion !== null || !leftUrl) return;
    if (lazyAttemptedRef.current.has(photo.id)) return;
    lazyAttemptedRef.current.add(photo.id);

    let cancelled = false;
    (async () => {
      try {
        const img = await loadStereoSourceImage(galleryPhoto, folderUrl);
        const est = await estimateImageAlignment(img, { swapped: storedAlignment.swapped });
        if (cancelled) return;
        if (est.confidence < AUTO_PERSIST_MIN_CONFIDENCE) return;
        const next = applyEstimate(est, storedAlignment.swapped);
        await updatePhotoAlignment({ photoId: photo.id, alignment: next, version: est.version, confidence: est.confidence });
        if (cancelled) return;
        onAlignmentSaved?.(photo.id, next, est.version);
        const flipped = next.swapped !== storedAlignment.swapped;
        setAutoNote(
          flipped
            ? 'Auto-aligned and flipped L/R'
            : next.dy === 0 && next.dx === 0
              ? 'Checked: already aligned'
              : `Auto-aligned (vertical ${next.dy > 0 ? '+' : ''}${next.dy} px)`,
        );
      } catch {
        // Best effort; Re-align in Management measures it again.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canEdit, folderUrl, galleryPhoto, leftUrl, photo.id, storedAlignment.dx, storedAlignment.swapped, onAlignmentSaved]);

  // Keyboard navigation. Desktop fullscreen is landscape, so it renders the
  // stereo view, where there is no other pointer affordance for paging.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        if (hasPrevious) onPrevious();
      } else if (event.key === 'ArrowRight') {
        if (hasNext) onNext();
      } else if (event.key === 'Escape') {
        if (shareOpen) setShareOpen(false);
        else onClose();
      } else {
        return;
      }
      event.preventDefault();
      setShowControls(true);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasPrevious, hasNext, onPrevious, onNext, onClose, shareOpen]);

  // One stage for both the placeholder and the sharp eyes. Until the split
  // result exists, the eye's shape comes from the grid thumbnail (half its
  // width), so the placeholder is drawn in the box the sharp image will fill:
  // same size, same letterboxing, and the fade-in later moves nothing. The
  // alignment crop changes the final shape by a pixel or two at most.
  const thumbSrc = galleryPhoto.thumbSrc;
  const thumbSize = useNaturalImageSize(thumbSrc);
  const eyeSource = dimensions ?? (thumbSize ? eyeSizeFromThumb(thumbSize.width, thumbSize.height) : null);
  const viewport = eyeViewport(mode, containerSize.width, containerSize.height);
  const stage = eyeSource ? fitContain(eyeSource.width, eyeSource.height, viewport.width, viewport.height) : null;

  // Reveal: the sharp eyes mount at opacity 0 over the placeholder and fade in
  // once BOTH have decoded (a pair appearing one eye at a time is unpleasant
  // to fuse). The fade only happens when a placeholder was actually shown;
  // a cache hit renders the sharp eyes directly, so paging through prepared
  // neighbours never flashes the thumbnail.
  const [loadedUrls, setLoadedUrls] = useState<Set<string>>(() => new Set());
  const [placeholderShown, setPlaceholderShown] = useState(false);
  const [placeholderGone, setPlaceholderGone] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  const markLoaded = useCallback((url: string) => {
    setLoadedUrls((current) => (current.has(url) ? current : new Set(current).add(url)));
  }, []);
  useEffect(() => {
    setLoadedUrls(new Set());
    setPlaceholderShown(false);
    setPlaceholderGone(false);
  }, [photo.id]);
  const placeholderAvailable = !!thumbSrc && !!stage;
  useEffect(() => {
    if (isLoading && placeholderAvailable) setPlaceholderShown(true);
  }, [isLoading, placeholderAvailable]);
  const finalReady =
    !!leftUrl && loadedUrls.has(leftUrl) && (mode === '2d' || (!!rightUrl && loadedUrls.has(rightUrl)));
  useEffect(() => {
    if (!finalReady || !placeholderShown) return;
    const timer = window.setTimeout(() => setPlaceholderGone(true), FADE_MS + 50);
    return () => window.clearTimeout(timer);
  }, [finalReady, placeholderShown]);
  // The spinner only appears for loads that are actually slow; quick ones
  // show the placeholder sharpening and nothing else.
  useEffect(() => {
    if (!isLoading) {
      setSlowLoading(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowLoading(true), SPINNER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isLoading]);
  // A 3D transform plus will-change parks the stage on its own GPU layer, which
  // is what makes the gesture smooth. That layer is rasterized once and then
  // stretched, so holding it after the gesture leaves the image blurry while
  // zoomed. Once the transform settles, fall back to a 2D transform with no
  // hint and let the browser re-rasterize at the zoomed resolution.
  const isTransforming = useTransformSettle(`${scale}:${translateX}:${translateY}`);
  const imageTransform = isTransforming
    ? `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`
    : `translate(${translateX}px, ${translateY}px) scale(${scale})`;

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
  // Previous, Next, Close and Share show and hide together: one tap on the photo flips them. Taps that start on a
  // control, pinches, pans, swipes and double taps never flip them.
  const controlVisibility = showControls ? 'opacity-100' : 'pointer-events-none opacity-0';
  const roundButton = 'rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200';
  // Previous / Next: large, vertically centred on the screen edges, frosted
  // glass (a strong backdrop blur with a light tint and a hairline edge)
  // rather than a flat grey disc, so they read on bright and dark photos alike.
  // Previous / Next: small frosted-glass buttons side by side at the bottom
  // right, out of the picture's way (the photographer's own viewer does the
  // same). The touch target stays 44 px even though the disc is smaller.
  const navButton =
    'flex h-11 w-11 items-center justify-center rounded-full ' +
    'border border-white/25 bg-white/10 text-white shadow-md shadow-black/30 ' +
    'backdrop-blur-xl backdrop-saturate-150 transition-colors hover:bg-white/20 active:bg-white/25 ' +
    'disabled:opacity-30';

  const closeButton = (
    <button
      onClick={(e) => { e.stopPropagation(); onClose(); }}
      data-viewer-control
      className={cn('absolute right-4 top-4', roundButton, controlVisibility)}
      aria-label="Close"
    >
      <X className="h-6 w-6" />
    </button>
  );

  const sharePanel = shareOpen && linkUrl && (
    <ViewerSharePanel linkUrl={linkUrl} onSharePhoto={() => void handleShare()} onClose={() => setShareOpen(false)} />
  );

  const shareButton = (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (linkUrl) setShareOpen((open) => !open);
        else void handleShare();
      }}
      data-viewer-control
      className={cn('absolute left-4 top-4', roundButton, controlVisibility)}
      aria-label="Share"
    >
      <Share2 className="h-6 w-6" />
    </button>
  );

  // One eye's stage: the grid thumbnail clipped to this eye underneath (crisp,
  // not blurred - a low-resolution photo reads as "loading detail", a blurred
  // one reads as broken), the sharp eye on top fading in. The 200%-wide clip
  // is exact because the stage has the half-thumbnail's aspect.
  const renderEye = (eye: 'left' | 'right', url: string | null, transform: string, willChange: string) => {
    if (!stage) return null;
    const rightHalf = eye === 'right' ? !storedAlignment.swapped : storedAlignment.swapped;
    return (
      <div
        className="viewer-stage relative overflow-hidden"
        style={{ width: stage.width, height: stage.height, transform, willChange }}
      >
        {thumbSrc && !placeholderGone && (
          <img
            src={thumbSrc}
            alt=""
            draggable={false}
            className={cn(
              'absolute inset-y-0 h-full w-[200%] max-w-none object-cover',
              rightHalf ? 'right-0 object-right' : 'left-0 object-left',
            )}
          />
        )}
        {url && (
          <img
            key={url}
            src={url}
            alt={eye === 'left' ? `${photo.alt} (left)` : `${photo.alt} (right)`}
            draggable={false}
            // A data URL that is already decoded never fires onLoad again.
            ref={(element) => {
              if (element && element.complete && element.naturalWidth > 0) markLoaded(url);
            }}
            onLoad={() => markLoaded(url)}
            className={cn(
              'absolute inset-0 h-full w-full',
              placeholderShown && 'transition-opacity duration-200 ease-out',
              placeholderShown && !finalReady ? 'opacity-0' : 'opacity-100',
            )}
          />
        )}
      </div>
    );
  };

  const loadingIndicator = isLoading && (
    placeholderAvailable ? (
      slowLoading && (
        <div className="pointer-events-none absolute right-16 top-4 [padding-right:env(safe-area-inset-right)]">
          <Loader2 className="h-5 w-5 animate-spin text-white/50" />
        </div>
      )
    ) : (
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-white/60" />
      </div>
    )
  );

  const errorIndicator = error && (
    <div className="absolute inset-0 flex items-center justify-center">
      <p className="px-4 text-center text-red-400">{error}</p>
    </div>
  );

  const navButtons = (hasPrevious || hasNext) && (
    <div
      data-viewer-control
      className={cn(
        'absolute bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] flex gap-2 transition-opacity duration-200',
        controlVisibility,
      )}
    >
      <button
        onClick={(e) => { e.stopPropagation(); onPrevious(); }}
        disabled={!hasPrevious}
        className={navButton}
        aria-label="Previous photo"
      >
        <ChevronLeft className="h-6 w-6" strokeWidth={2.25} />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onNext(); }}
        disabled={!hasNext}
        className={navButton}
        aria-label="Next photo"
      >
        <ChevronRight className="h-6 w-6" strokeWidth={2.25} />
      </button>
    </div>
  );

  // Transient note: what the lazy estimator did.
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
        ref={containerRef}
        className="viewer-container flex h-full w-full items-center justify-center bg-black"
        onPointerMove={handleMouseActivity}
        onTouchCancel={handleTouchCancel_2d}
        onTouchStartCapture={markTouch}
        onTouchEndCapture={markTouch}
        onTouchStart={handleTouchStart_2d}
        onTouchEnd={handleTouchEnd_2d}
        onClick={handleContainerClick}
      >
        <div className="flex h-full w-full items-center justify-center overflow-hidden">
          {renderEye('left', leftUrl, 'none', 'auto')}
        </div>
        {loadingIndicator}
        {errorIndicator}
        {closeButton}
        {shareButton}
        {sharePanel}
        {navButtons}
      </div>
    );
  }

  // Stereo Mode
  return (
    <div
      ref={containerRef}
      onPointerMoveCapture={handleMouseActivity}
      className="viewer-container h-full w-full flex items-center justify-center bg-black"
      onTouchStartCapture={markTouch}
      onTouchEndCapture={markTouch}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
      onClick={handleContainerClick}
    >
      <div className="flex h-full w-full">
        <div className="flex h-full w-1/2 items-center justify-center overflow-hidden">
          {renderEye('left', leftUrl, imageTransform, isTransforming ? 'transform' : 'auto')}
        </div>
        <div className="flex h-full w-1/2 items-center justify-center overflow-hidden">
          {renderEye('right', rightUrl, imageTransform, isTransforming ? 'transform' : 'auto')}
        </div>
      </div>
      {loadingIndicator}
      {errorIndicator}
      {closeButton}
      {shareButton}
      {sharePanel}
      {estimatorChips}
      {navButtons}
      {Math.abs(scale - 1) > 0.01 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-secondary/60 px-3 py-1 text-sm text-muted-foreground backdrop-blur-sm">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );
}
