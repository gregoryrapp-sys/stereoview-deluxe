import { lazy, Suspense, useEffect, useState } from 'react';
import { Check, ChevronLeft, Copy, Image as ImageIcon, Link as LinkIcon, Share2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Loaded on first use only; visitors who never share never download it.
const QRCodeCanvas = lazy(async () => {
  const mod = await import('qrcode.react');
  return { default: mod.QRCodeCanvas };
});

interface ViewerSharePanelProps {
  /** Address that opens this album on this photo. */
  linkUrl: string;
  /** Hands the 2D (displayed-left) image to the device's share sheet. */
  onSharePhoto: () => void;
  onClose: () => void;
}

/**
 * Share choices inside the fullscreen viewer: the photo itself, or a link
 * shown as text (copy, or the device's share sheet) and as a QR code.
 *
 * Rendered inline, not in a portal: the viewer runs in browser fullscreen,
 * where anything attached to <body> (dialogs, popovers) is not displayed.
 */
export default function ViewerSharePanel({ linkUrl, onSharePhoto, onClose }: ViewerSharePanelProps) {
  const [view, setView] = useState<'menu' | 'link'>('menu');
  const [copied, setCopied] = useState(false);
  const canShareLink = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
    } catch {
      // Clipboard refused (older WebViews): the address is selectable text below.
    }
  };

  const shareLink = async () => {
    try {
      await navigator.share({ url: linkUrl });
    } catch {
      // Dismissed or unsupported; nothing to report.
    }
  };

  const item =
    'flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium text-white hover:bg-white/10 active:bg-white/15';

  return (
    <div
      data-viewer-control
      role="dialog"
      aria-label="Share"
      onClick={(e) => e.stopPropagation()}
      className="absolute left-4 top-20 z-10 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-white/15 bg-black/60 p-2 text-white shadow-xl shadow-black/40 backdrop-blur-xl backdrop-saturate-150"
    >
      <div className="flex items-center justify-between px-2 pb-1 pt-1">
        {view === 'link' ? (
          <button type="button" onClick={() => setView('menu')} className="flex items-center gap-1 text-xs text-white/70 hover:text-white">
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        ) : (
          <span className="text-xs font-medium uppercase tracking-wider text-white/60">Share</span>
        )}
        <button type="button" onClick={onClose} aria-label="Close share options" className="rounded-full p-1 text-white/70 hover:bg-white/10 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      {view === 'menu' ? (
        <div className="flex flex-col">
          <button type="button" className={item} onClick={() => { onSharePhoto(); onClose(); }}>
            <ImageIcon className="h-5 w-5 shrink-0" />
            <span>
              Share photo
              <span className="block text-xs font-normal text-white/60">The picture, in 2D, through your device</span>
            </span>
          </button>
          <button type="button" className={item} onClick={() => setView('link')}>
            <LinkIcon className="h-5 w-5 shrink-0" />
            <span>
              Share link
              <span className="block text-xs font-normal text-white/60">Address or QR code that opens this photo in 3D</span>
            </span>
          </button>
        </div>
      ) : (
        <div className="space-y-3 px-2 pb-2">
          <div className="flex justify-center rounded-xl bg-white p-3">
            <Suspense fallback={<div className="h-[180px] w-[180px]" />}>
              <QRCodeCanvas value={linkUrl} size={180} level="M" />
            </Suspense>
          </div>
          <p className="select-all break-all rounded-lg bg-white/10 px-2 py-1.5 font-mono text-[11px] text-white/80">{linkUrl}</p>
          <div className={cn('grid gap-2', canShareLink ? 'grid-cols-2' : 'grid-cols-1')}>
            <button type="button" onClick={copy} className="flex items-center justify-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-sm font-medium hover:bg-white/25">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            {canShareLink && (
              <button type="button" onClick={shareLink} className="flex items-center justify-center gap-1.5 rounded-lg bg-white/15 px-3 py-2 text-sm font-medium hover:bg-white/25">
                <Share2 className="h-4 w-4" />
                Send link
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
