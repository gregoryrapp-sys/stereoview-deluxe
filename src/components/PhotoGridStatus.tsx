import { Cloud, Loader2 } from 'lucide-react';
import type { ListingStatus } from '@/hooks/useDropboxListing';
import { photoCountLabel } from '@/lib/photoCount';
import { cn } from '@/lib/utils';

/**
 * The count line under an album title: "Counting photos…" with a spinner
 * until a Dropbox folder is listed, then the final total, with previews
 * still arriving shown separately.
 */
export function PhotoCount({
  total,
  status,
  previewsSettled,
  dropboxLive,
  className,
}: {
  total: number;
  status?: ListingStatus;
  previewsSettled?: number;
  dropboxLive?: boolean;
  className?: string;
}) {
  const { count, progress } = photoCountLabel({ total, status, previewsSettled });
  return (
    <p className={cn('flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground', className)} aria-live="polite">
      {status === 'loading' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      <span className="tabular-nums">{count}</span>
      {progress && (
        <span className="flex items-center gap-1 text-xs tabular-nums text-muted-foreground/80">
          <span aria-hidden>·</span>
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          {progress}
        </span>
      )}
      {dropboxLive && (
        <span className="flex items-center gap-1 font-medium text-sky-600 dark:text-sky-400">
          <span aria-hidden>·</span>
          <Cloud className="h-3 w-3" /> Dropbox Live
        </span>
      )}
    </p>
  );
}

/**
 * Stand-in tiles while a folder is being listed: the grid keeps its place
 * and shape, so nothing jumps when the photos arrive.
 */
export function PhotoGridSkeleton({ tiles = 8 }: { tiles?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4" aria-busy="true" aria-label="Loading photos">
      {Array.from({ length: tiles }, (_, i) => (
        <div key={i} className="overflow-hidden rounded-md bg-secondary/60">
          <div className="aspect-square animate-pulse bg-secondary" />
          <div className="space-y-1 p-1.5">
            <div className="h-2.5 w-3/4 rounded bg-muted-foreground/15" />
            <div className="h-2.5 w-1/3 rounded bg-muted-foreground/10" />
          </div>
        </div>
      ))}
    </div>
  );
}
