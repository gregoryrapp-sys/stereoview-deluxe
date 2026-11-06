import { useState } from 'react';
import { Copy, QrCode, Send, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ShareQrDialog } from '@/components/ShareLinkField';
import { copyLink } from '@/lib/copyLink';

interface ShareLinkButtonProps {
  /** Public address of the photographer, event or album page. */
  url: string;
  /** What the link opens, for the menu heading: "album", "event", "gallery". */
  what: string;
}

/**
 * Share for a whole page (photographer, event or album): the link, or its QR
 * code. Single photos are shared as the picture itself from the viewer.
 */
export default function ShareLinkButton({ url, what }: ShareLinkButtonProps) {
  const [qrOpen, setQrOpen] = useState(false);
  const canSend = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const send = async () => {
    try {
      await navigator.share({ url });
    } catch {
      // Dismissed or unsupported; nothing to report.
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" className="gap-2">
            <Share2 className="h-4 w-4" />
            Share
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Share this {what}</DropdownMenuLabel>
          <DropdownMenuItem className="gap-2" onSelect={() => void copyLink(url)}>
            <Copy className="h-4 w-4" />
            Copy link
          </DropdownMenuItem>
          {canSend && (
            <DropdownMenuItem className="gap-2" onSelect={() => void send()}>
              <Send className="h-4 w-4" />
              Send link...
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className="gap-2" onSelect={() => setQrOpen(true)}>
            <QrCode className="h-4 w-4" />
            QR code
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ShareQrDialog url={url} open={qrOpen} onOpenChange={setQrOpen} />
    </>
  );
}
