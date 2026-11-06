import { lazy, Suspense, useRef, useState } from 'react';
import { Copy, Download, QrCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { copyLink } from '@/lib/copyLink';
import { cn } from '@/lib/utils';

// The QR renderer is only needed once the dialog opens, and never for visitors,
// so it stays out of the main bundle.
const QRCodeCanvas = lazy(async () => {
  const mod = await import('qrcode.react');
  return { default: mod.QRCodeCanvas };
});

interface ShareLinkFieldProps {
  url: string;
  /** Unlisted objects have no other way in, so the link gets more weight. */
  emphasize?: boolean;
  /** The slug in the form differs from the saved one; the link shows the saved URL. */
  stale?: boolean;
}

/**
 * The public URL of a profile, event or album, with Copy and a QR code.
 *
 * The photographer already prints QR codes for couples by hand; this puts the
 * code next to the setting that makes a page link-only.
 */
export default function ShareLinkField({ url, emphasize = false, stale = false }: ShareLinkFieldProps) {
  const [qrOpen, setQrOpen] = useState(false);

  if (!url) return null;

  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          'flex min-w-0 items-center gap-2 rounded-md border p-1.5',
          emphasize ? 'border-amber-500/50 bg-amber-500/5' : 'border-border bg-secondary/40',
        )}
      >
        <p className="min-w-0 flex-1 select-all truncate px-1.5 font-mono text-xs text-muted-foreground">{url}</p>
        <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0 gap-1 px-2" onClick={() => copyLink(url)}>
          <Copy className="h-3.5 w-3.5" />
          Copy link
        </Button>
        <Button type="button" size="sm" variant="secondary" className="h-8 shrink-0 gap-1 px-2" onClick={() => setQrOpen(true)}>
          <QrCode className="h-3.5 w-3.5" />
          QR code
        </Button>
      </div>
      {stale && (
        <p className="text-xs text-muted-foreground">Save to update the link with the new URL slug.</p>
      )}
      <ShareQrDialog url={url} open={qrOpen} onOpenChange={setQrOpen} />
    </div>
  );
}

/** A page's QR code, large enough to print, with a PNG download. */
export function ShareQrDialog({ url, open, onOpenChange }: { url: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const qrWrapperRef = useRef<HTMLDivElement>(null);

  const downloadPng = () => {
    const canvas = qrWrapperRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `${new URL(url).pathname.replace(/^\//, '').replace(/\//g, '-') || 'page'}-qr.png`;
    link.click();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>QR code</DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">{url}</DialogDescription>
        </DialogHeader>
        <div ref={qrWrapperRef} className="flex justify-center rounded-md bg-white p-4">
          <Suspense fallback={<div className="h-[256px] w-[256px] animate-pulse rounded bg-neutral-200" />}>
            <QRCodeCanvas value={url} size={256} level="M" includeMargin />
          </Suspense>
        </div>
        <Button type="button" variant="secondary" className="gap-2" onClick={downloadPng}>
          <Download className="h-4 w-4" />
          Download PNG
        </Button>
      </DialogContent>
    </Dialog>
  );
}
