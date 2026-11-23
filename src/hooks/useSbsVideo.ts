import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Plays a side-by-side video into one canvas per eye.
 *
 * One <video> element decodes the file; every new frame is drawn into the
 * left-eye and right-eye canvases (source rectangles = the two halves). Two
 * <video> elements would drift apart; one decoder keeps the eyes on the same
 * frame by construction. The canvases then take the same zoom and pan
 * transform as a photo's eyes, so gestures work identically.
 */

interface EyeSize {
  width: number;
  height: number;
}

interface Options {
  /** Signed URL of the video; null when the item on screen is a photo. */
  src: string | null;
  /** The pair is stored right-eye first (album setting): draw the halves the other way round. */
  swapped: boolean;
}

export interface SbsVideo {
  videoRef: (element: HTMLVideoElement | null) => void;
  leftCanvasRef: (element: HTMLCanvasElement | null) => void;
  rightCanvasRef: (element: HTMLCanvasElement | null) => void;
  /** One eye's size in video pixels, once the metadata is in. */
  eyeSize: EyeSize | null;
  /** A frame has been drawn: the poster placeholder can go. */
  ready: boolean;
  playing: boolean;
  muted: boolean;
  currentTime: number;
  duration: number;
  error: string | null;
  togglePlay: () => void;
  toggleMute: () => void;
  seek: (seconds: number) => void;
}

const UNSUPPORTED_MESSAGE =
  "This browser can't play this video (HEVC / H.265). Open it in Safari, or in Chrome or Edge on a recent computer.";

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function useSbsVideo({ src, swapped }: Options): SbsVideo {
  const videoEl = useRef<FrameVideo | null>(null);
  const leftCanvas = useRef<HTMLCanvasElement | null>(null);
  const rightCanvas = useRef<HTMLCanvasElement | null>(null);
  const swappedRef = useRef(swapped);
  swappedRef.current = swapped;

  const [eyeSize, setEyeSize] = useState<EyeSize | null>(null);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Bumped when the <video> element mounts or unmounts, so the listeners re-attach. */
  const [videoMount, setVideoMount] = useState(0);

  const draw = useCallback(() => {
    const video = videoEl.current;
    if (!video || video.readyState < 2) return;
    const eyeWidth = Math.floor(video.videoWidth / 2);
    const height = video.videoHeight;
    if (eyeWidth <= 0 || height <= 0) return;
    const leftX = swappedRef.current ? eyeWidth : 0;
    const rightX = swappedRef.current ? 0 : eyeWidth;
    for (const [canvas, sx] of [[leftCanvas.current, leftX], [rightCanvas.current, rightX]] as const) {
      if (!canvas) continue;
      if (canvas.width !== eyeWidth || canvas.height !== height) {
        canvas.width = eyeWidth;
        canvas.height = height;
      }
      canvas.getContext('2d')?.drawImage(video, sx, 0, eyeWidth, height, 0, 0, eyeWidth, height);
    }
    setReady(true);
  }, []);

  const drawRef = useRef(draw);
  drawRef.current = draw;

  // A canvas that mounts later (2D -> stereo on rotation) gets the current
  // frame immediately rather than waiting for the next one.
  const leftCanvasRef = useCallback((element: HTMLCanvasElement | null) => {
    leftCanvas.current = element;
    if (element) drawRef.current();
  }, []);
  const rightCanvasRef = useCallback((element: HTMLCanvasElement | null) => {
    rightCanvas.current = element;
    if (element) drawRef.current();
  }, []);
  const videoRef = useCallback((element: HTMLVideoElement | null) => {
    videoEl.current = element as FrameVideo | null;
    // React does not reliably reflect `muted` from markup, and browsers only
    // autoplay muted video; set it on the element before loading starts.
    if (element) {
      element.defaultMuted = true;
      element.muted = true;
    }
    setVideoMount((n) => n + 1);
  }, []);

  // A new video starts from scratch: no frame, no error, muted autoplay
  // (browsers only autoplay muted; the speaker button unmutes).
  useEffect(() => {
    if (videoEl.current) videoEl.current.muted = true;
    setEyeSize(null);
    setReady(false);
    setPlaying(false);
    setMuted(true);
    setCurrentTime(0);
    setDuration(0);
    setError(null);
  }, [src]);

  useEffect(() => {
    const video = videoEl.current;
    if (!video || !src) return;

    let frameHandle: number | null = null;
    let rafHandle: number | null = null;
    const scheduleFrames = () => {
      if (video.requestVideoFrameCallback) {
        frameHandle = video.requestVideoFrameCallback(() => {
          draw();
          if (!video.paused) scheduleFrames();
        });
      } else {
        rafHandle = requestAnimationFrame(() => {
          draw();
          if (!video.paused) scheduleFrames();
        });
      }
    };
    const stopFrames = () => {
      if (frameHandle !== null) video.cancelVideoFrameCallback?.(frameHandle);
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
      frameHandle = null;
      rafHandle = null;
    };

    const onMetadata = () => {
      // A browser without an HEVC decoder does not report an error: it plays
      // the soundtrack alone with a 0x0 picture. Say so instead of showing black.
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        video.pause();
        setError(UNSUPPORTED_MESSAGE);
        return;
      }
      setEyeSize({ width: Math.floor(video.videoWidth / 2), height: video.videoHeight });
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const onPlay = () => {
      setPlaying(true);
      stopFrames();
      scheduleFrames();
    };
    const onPause = () => {
      setPlaying(false);
      stopFrames();
      draw();
    };
    const onTime = () => setCurrentTime(video.currentTime);
    const onVolume = () => setMuted(video.muted);
    // Read the failure from the player itself: canPlayType is no guide here
    // (desktop Chrome answers "" for HEVC and then plays it fine).
    const onError = () => {
      stopFrames();
      const code = video.error?.code;
      setError(
        code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED || code === MediaError.MEDIA_ERR_DECODE
          ? UNSUPPORTED_MESSAGE
          : 'The video could not be loaded. Check the connection and try again.',
      );
    };

    video.addEventListener('loadedmetadata', onMetadata);
    video.addEventListener('loadeddata', draw);
    video.addEventListener('seeked', draw);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('timeupdate', onTime);
    video.addEventListener('volumechange', onVolume);
    video.addEventListener('error', onError);
    if (video.readyState >= 1) onMetadata();
    if (video.readyState >= 2) draw();
    if (!video.paused) onPlay();

    return () => {
      stopFrames();
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('loadeddata', draw);
      video.removeEventListener('seeked', draw);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('timeupdate', onTime);
      video.removeEventListener('volumechange', onVolume);
      video.removeEventListener('error', onError);
    };
  }, [src, draw, videoMount]);

  // Album setting changed under an open video: redraw with the halves swapped.
  useEffect(() => {
    draw();
  }, [swapped, draw]);

  const togglePlay = useCallback(() => {
    const video = videoEl.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoEl.current;
    if (!video) return;
    video.muted = !video.muted;
    // Unmuting is a user gesture; resume if the browser had held playback back.
    if (!video.muted && video.paused) void video.play().catch(() => undefined);
  }, []);

  const seek = useCallback((seconds: number) => {
    const video = videoEl.current;
    if (!video || !Number.isFinite(seconds)) return;
    video.currentTime = Math.max(0, Math.min(seconds, video.duration || seconds));
  }, []);

  return {
    videoRef,
    leftCanvasRef,
    rightCanvasRef,
    eyeSize,
    ready,
    playing,
    muted,
    currentTime,
    duration,
    error,
    togglePlay,
    toggleMute,
    seek,
  };
}
