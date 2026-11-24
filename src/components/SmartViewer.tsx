import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ArrowLeftRight, ChevronLeft, ChevronRight, Loader2, Pause, Play, Share2, Volume2, VolumeX, X } from 'lucide-react';
import type { Photo } from '@/data/photos';
import { useStereoGestures } from '@/hooks/useStereoGestures';
import { useProcessedImage, usePreloadImages } from '@/hooks/useProcessedImage';
import { useTransformSettle } from '@/hooks/useTransformSettle';
import { useNaturalImageSize } from '@/hooks/useNaturalImageSize';
import { eyeSizeFromThumb, eyeViewport, fitContain } from '@/lib/viewerGeometry';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { type EyeTier, resolveAlignment, ZOOM_TIER_MIN_SCALE } from '@/lib/imageProcessing';
import type { GalleryPhoto } from '@/services/galleryService';
import { formatDuration, isVideoPhoto } from '@/lib/media';
import { useSbsVideo } from '@/hooks/useSbsVideo';
import { MAX_SEPARATION_STEPS, separationOffsetPx, useEyeSeparation } from '@/hooks/useEyeSeparation';
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
  /**
   * QuickView: the items are files from this device, not album photos. Share
   * sends the picture itself; a video has nothing to share (no page to link).
   */
  local?: boolean;
  /** Shows a Flip L/R control (QuickView): exchange which half is the left eye. */
  onFlipEyes?: () => void;
  eyesFlipped?: boolean;
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
  local = false,
  onFlipEyes,
  eyesFlipped = false,
}: SmartViewerProps) {
  const [mode, setMode] = useState<ViewMode>('stereo');
  const [showControls, setShowControls] = useState(true);
  /** Bumped by any interaction, so the auto-hide countdown starts over. */
  const [interaction, setInteraction] = useState(0);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // Halves are shown as stored, exchanged only for albums whose camera writes
  // right-eye first. There is no per-photo alignment.
  const storedAlignment = resolveAlignment(photo);
  const galleryPhoto = photo as GalleryPhoto;
  // A side-by-side video plays into the same two eye stages a photo is split
  // into (see useSbsVideo), so zoom, pan and swipe behave identically.
  const isVideo = isVideoPhoto(galleryPhoto);

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

  // Neighbouring videos are not preloaded: they stream when opened.
  const adjacentStills = useMemo(() => adjacentPhotos.filter((item) => !isVideoPhoto(item as GalleryPhoto)), [adjacentPhotos]);
  usePreloadImages(adjacentStills, album, { eyes });

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
    if (!showControls) return;
    const timer = window.setTimeout(() => setShowControls(false), CONTROLS_AUTO_HIDE_MS);
    return () => window.clearTimeout(timer);
  }, [showControls, interaction]);

  const handleMouseActivity = useCallback((event: React.PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    setShowControls(true);
    setInteraction((n) => n + 1);
  }, []);
  const toggleControlsFromTouch = useCallback(() => {
    lastTouchTapAtRef.current = Date.now();
    setShowControls((current) => !current);
  }, []);

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
      // A range input (the video's seek slider) needs the browser's own drag.
      if (event.target instanceof HTMLInputElement && event.target.type === 'range') return;
      if (event.cancelable) event.preventDefault();
    };
    el.addEventListener('touchmove', keep, { passive: false });
    return () => el.removeEventListener('touchmove', keep);
  }, [mode]);

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
    // Portrait shows one eye across the whole screen, and a downward swipe
    // (at normal size) closes the viewer, as it always has there.
    singleEye: mode === '2d',
    onSwipeDown: mode === '2d' ? onClose : undefined,
  });

  // Rotating between portrait and landscape changes what one eye is; start
  // the new layout unzoomed rather than carry a pan that no longer fits.
  useEffect(() => {
    resetTransform();
  }, [mode, resetTransform]);

  // Pinched past the fit tier's headroom: ask for eyes at (up to) source
  // resolution. The fit tier stays on screen until the sharper one arrives.
  const tier: EyeTier = scale >= ZOOM_TIER_MIN_SCALE ? 'zoom' : 'fit';
  const { leftUrl, rightUrl, isLoading: imageLoading, error: imageError, dimensions } = useProcessedImage(isVideo ? null : photo, album, {
    eyes,
    alignment: storedAlignment,
    tier,
  });
  const video = useSbsVideo({ src: isVideo ? photo.src : null, swapped: storedAlignment.swapped });
  const { togglePlay: toggleVideoPlay, toggleMute: toggleVideoMute } = video;

  // The viewer's own spacing between the eyes, kept on this device.
  const separation = useEyeSeparation();
  const separationPx = separationOffsetPx(separation.steps, containerSize.width / 2);
  const isLoading = isVideo ? !video.ready && !video.error : imageLoading;
  const error = isVideo ? video.error : imageError;

  useEffect(() => {
    resetTransform();
    // Opening the viewer or arriving by keyboard shows the controls; a swipe
    // does not. Someone paging through an album with the controls hidden
    // had them pop back up on every photo, which is exactly when they are in
    // the way.
    if (Date.now() - lastSwipeAtRef.current > 500) setShowControls(true);
  }, [photo.id, resetTransform]);

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

  // Keyboard navigation. Desktop fullscreen is landscape, so it renders the
  // stereo view, where there is no other pointer affordance for paging.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        if (hasPrevious) onPrevious();
      } else if (event.key === 'ArrowRight') {
        if (hasNext) onNext();
      } else if (event.key === 'Escape') {
        onClose();
      } else if (isVideo && (event.key === ' ' || event.key === 'k')) {
        toggleVideoPlay();
      } else if (isVideo && event.key === 'm') {
        toggleVideoMute();
      } else {
        return;
      }
      event.preventDefault();
      setShowControls(true);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasPrevious, hasNext, onPrevious, onNext, onClose, isVideo, toggleVideoPlay, toggleVideoMute]);

  // One stage for both the placeholder and the sharp eyes. Until the split
  // result exists, the eye's shape comes from the grid thumbnail (half its
  // width), so the placeholder is drawn in the box the sharp image will fill:
  // same size, same letterboxing, and the fade-in later moves nothing. The
  // alignment crop changes the final shape by a pixel or two at most.
  const thumbSrc = galleryPhoto.thumbSrc;
  const thumbSize = useNaturalImageSize(thumbSrc);
  const eyeSource = (isVideo ? video.eyeSize : dimensions) ?? (thumbSize ? eyeSizeFromThumb(thumbSize.width, thumbSize.height) : null);
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
    // A video is far too large to attach; share the page that plays it.
    if (isVideo) {
      try {
        await navigator.share?.({ url: window.location.href });
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') console.warn('Share failed', e);
      }
      return;
    }
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
  }, [leftUrl, isVideo]);

  // --- Common UI Elements ---
  // Previous, Next, Close and Share show and hide together: one tap on the photo flips them. Taps that start on a
  // control, pinches, pans, swipes and double taps never flip them.
  const controlVisibility = showControls ? 'opacity-100' : 'pointer-events-none opacity-0';
  const roundButton = 'rounded-full bg-white/20 p-3 text-white backdrop-blur-sm transition-opacity duration-200';
  // Flip L/R, top centre (QuickView only): pictures straight off a camera
  // can be stored either way round.
  const flipButton = onFlipEyes && (
    <button
      onClick={(e) => { e.stopPropagation(); onFlipEyes(); }}
      data-viewer-control
      aria-pressed={eyesFlipped}
      className={cn(
        'absolute left-1/2 top-4 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-4 py-3 text-sm font-medium text-white backdrop-blur-sm transition-opacity duration-200',
        eyesFlipped ? 'bg-sky-500/70' : 'bg-white/20',
        controlVisibility,
      )}
      aria-label="Flip left and right"
    >
      <ArrowLeftRight className="h-5 w-5" />
      {eyesFlipped ? 'R | L' : 'L | R'}
    </button>
  );

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

  const shareButton = !(local && isVideo) && (
    <button
      onClick={(e) => {
        e.stopPropagation();
        void handleShare();
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
    if (isVideo) {
      // The poster frame stays underneath until the first video frame is drawn.
      return (
        <div
          className="viewer-stage relative overflow-hidden"
          style={{ width: stage.width, height: stage.height, transform, willChange }}
        >
          {thumbSrc && !video.ready && (
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
          <canvas
            ref={eye === 'left' ? video.leftCanvasRef : video.rightCanvasRef}
            aria-label={eye === 'left' ? `${photo.alt} (left)` : `${photo.alt} (right)`}
            className="absolute inset-0 h-full w-full"
          />
        </div>
      );
    }
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

  // The decoder. Kept in the DOM (tiny and invisible) because some browsers
  // stop decoding a detached or display:none video; its frames are drawn
  // into the eye canvases.
  const videoElement = isVideo && (
    <video
      key={photo.id}
      ref={video.videoRef}
      src={photo.src}
      crossOrigin="anonymous"
      playsInline
      muted
      autoPlay
      loop
      preload="auto"
      aria-hidden
      className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-0"
    />
  );

  // Play / sound / position, bottom left, showing and hiding with the other controls.
  const videoControls = isVideo && !video.error && (
    <>
      <button onClick={video.togglePlay} className={navButton} aria-label={video.playing ? 'Pause' : 'Play'}>
        {video.playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
      </button>
      <button onClick={video.toggleMute} className={navButton} aria-label={video.muted ? 'Unmute' : 'Mute'}>
        {video.muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
      </button>
      <input
        type="range"
        min={0}
        max={video.duration || 0}
        step={0.1}
        value={Math.min(video.currentTime, video.duration || 0)}
        onChange={(e) => video.seek(Number(e.target.value))}
        aria-label="Position"
        className="min-w-0 flex-1 accent-white"
      />
      <span className="shrink-0 text-xs tabular-nums text-white/80 drop-shadow">
        {formatDuration(video.currentTime)} / {formatDuration(video.duration)}
      </span>
    </>
  );

  // Eye separation, stereo only (portrait shows one eye): "> | <" brings the
  // two pictures toward the centre line, "< | >" moves them apart; the number
  // between them is the current setting, and tapping it returns to 0.
  const separationLabel = separation.steps > 0 ? `+${separation.steps}` : String(separation.steps);
  const separationControls = mode === 'stereo' && (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={separation.closer}
        disabled={separation.steps >= MAX_SEPARATION_STEPS}
        className={navButton}
        aria-label="Move the pictures closer together"
        title="Move the pictures closer together"
      >
        <span className="flex items-center" aria-hidden>
          <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
          <span className="h-4 w-0.5 rounded bg-white/60" />
          <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
        </span>
      </button>
      <button
        onClick={separation.reset}
        className="min-w-[2.25rem] rounded-full px-1 py-2 text-center text-xs font-medium tabular-nums text-white/80 drop-shadow"
        aria-label={`Picture spacing ${separationLabel}. Tap to reset`}
        title="Picture spacing. Tap to reset"
      >
        {separationLabel}
      </button>
      <button
        onClick={separation.farther}
        disabled={separation.steps <= -MAX_SEPARATION_STEPS}
        className={navButton}
        aria-label="Move the pictures farther apart"
        title="Move the pictures farther apart"
      >
        <span className="flex items-center" aria-hidden>
          <ChevronLeft className="h-4 w-4" strokeWidth={2.5} />
          <span className="h-4 w-0.5 rounded bg-white/60" />
          <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
        </span>
      </button>
    </div>
  );

  // Bottom left, across from Previous/Next: eye separation, then a video's
  // play / sound / position. Only as wide as its contents unless a seek bar
  // needs the room, so the rest of the bottom edge still takes taps and swipes.
  const bottomLeftBar = (separationControls || videoControls) && (
    <div
      data-viewer-control
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] flex items-center gap-2 transition-opacity duration-200',
        videoControls && 'right-32',
        controlVisibility,
      )}
    >
      {separationControls}
      {videoControls}
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

  const zoomBadge = Math.abs(scale - 1) > 0.01 && (
    <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-secondary/60 px-3 py-1 text-sm text-muted-foreground backdrop-blur-sm">
      {Math.round(scale * 100)}%
    </div>
  );

  // --- Render Logic ---
  if (mode === '2d') {
    return (
      <div
        ref={containerRef}
        className="viewer-container flex h-full w-full items-center justify-center bg-black"
        onPointerMove={handleMouseActivity}
        onTouchStartCapture={markTouch}
        onTouchEndCapture={markTouch}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onClick={handleContainerClick}
      >
        <div className="flex h-full w-full items-center justify-center overflow-hidden">
          {renderEye('left', leftUrl, imageTransform, isTransforming ? 'transform' : 'auto')}
        </div>
        {videoElement}
        {loadingIndicator}
        {errorIndicator}
        {closeButton}
        {shareButton}
        {flipButton}
        {bottomLeftBar}
        {navButtons}
        {zoomBadge}
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
        {/* Eye separation moves each picture toward (or away from) the centre line. */}
        <div className="flex h-full w-1/2 items-center justify-center overflow-hidden">
          <div style={{ transform: `translateX(${separationPx}px)` }}>
            {renderEye('left', leftUrl, imageTransform, isTransforming ? 'transform' : 'auto')}
          </div>
        </div>
        <div className="flex h-full w-1/2 items-center justify-center overflow-hidden">
          <div style={{ transform: `translateX(${-separationPx}px)` }}>
            {renderEye('right', rightUrl, imageTransform, isTransforming ? 'transform' : 'auto')}
          </div>
        </div>
      </div>
      {videoElement}
      {loadingIndicator}
      {errorIndicator}
      {closeButton}
      {shareButton}
      {flipButton}
      {bottomLeftBar}
      {navButtons}
      {zoomBadge}
    </div>
  );
}
