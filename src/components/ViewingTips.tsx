import { useState } from 'react';
import { Hand, Pointer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import RotatePhoneGraphic from '@/components/RotatePhoneGraphic';
import { type DeviceKind, deviceKind } from '@/lib/device';
import { cn } from '@/lib/utils';

/**
 * First-use tips above an album's photos, on phones and tablets only (a
 * mouse user neither rotates nor pinches). Shown until "Got it", then never
 * again on this device.
 *
 * Phone viewer / headset and free-viewing guidance is shown on phones only:
 * those are the uses the side-by-side layout supports. On a tablet or
 * monitor the halves are too far apart to free-view and too big for a
 * phone viewer. Free-viewing is parallel (relaxed eyes), matching the
 * left-eye-on-the-left layout; cross-eyed viewing would need the halves
 * swapped, so it is not suggested.
 */

export const TIPS_STORAGE_KEY = 'viewing-tips-dismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(TIPS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export default function ViewingTips({ device = deviceKind(), className }: { device?: DeviceKind; className?: string }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed || device === 'desktop') return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(TIPS_STORAGE_KEY, '1');
    } catch {
      // Private mode: hidden for this visit only.
    }
  };

  return (
    <aside className={cn('relative rounded-lg border border-border bg-card p-4 text-sm', className)} aria-label="Viewing tips">
      <button
        type="button"
        onClick={dismiss}
        className="absolute right-2 top-2 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label="Dismiss viewing tips"
      >
        <X className="h-4 w-4" />
      </button>
      <h2 className="mb-3 pr-8 text-sm font-medium">Viewing tips</h2>
      <ol className="space-y-2.5">
        <li className="flex items-start gap-3">
          <span className="flex w-7 shrink-0 justify-center"><RotatePhoneGraphic className="-my-0.5 h-7 w-7 text-sky-400" /></span>
          <span>
            <span className="font-medium">Turn your {device === 'phone' ? 'phone' : 'tablet'} sideways</span> to see both pictures side
            by side. Upright shows one.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex w-7 shrink-0 justify-center"><Pointer className="mt-0.5 h-5 w-5 text-sky-400" /></span>
          <span>
            <span className="font-medium">Tap a photo</span> to open it full screen.
          </span>
        </li>
        <li className="flex items-start gap-3">
          <span className="flex w-7 shrink-0 justify-center"><Hand className="mt-0.5 h-5 w-5 text-sky-400" /></span>
          <span>
            <span className="font-medium">Pinch to zoom, drag to pan.</span> Swipe sideways for the next photo.
          </span>
        </li>
      </ol>

      {device === 'phone' && (
        <div className="mt-4 space-y-1.5 border-t border-border pt-3 text-muted-foreground">
          <p>
            <span className="font-medium text-foreground">In a phone viewer or headset:</span> open a photo sideways, then
            place the phone in the viewer. If the pictures don't merge, use{' '}
            <span className="whitespace-nowrap font-mono text-foreground">{'>|<'}</span> or{' '}
            <span className="whitespace-nowrap font-mono text-foreground">{'<|>'}</span> at the bottom left to change the spacing.
          </p>
          <p>
            <span className="font-medium text-foreground">Without a viewer:</span> relax your eyes as if looking through the
            screen into the distance until the two pictures become one. Cross-eyed viewing isn't supported.
          </p>
        </div>
      )}

      <Button variant="secondary" size="sm" className="mt-4" onClick={dismiss}>
        Got it
      </Button>
    </aside>
  );
}
