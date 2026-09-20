import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ImageDown, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  backfillPhotoThumbnail,
  fetchPhotosMissingThumbnails,
  type PhotoMissingThumbnail,
} from '@/services/galleryService';

/**
 * One-time thumbnail generation for photos uploaded before thumbnails existed.
 *
 * Runs in the owner's browser: every original is downloaded once through a
 * signed URL, downscaled with the same code new uploads use, and stored beside
 * the original. That download is the whole cost (~1.1 MB per photo of egress),
 * and it is the same cost a server-side job would pay, so nothing is gained by
 * moving it off the laptop except a service key to look after. Resumable by
 * construction: it only ever sees rows whose thumb_path is still null.
 */

const CONCURRENCY = 3;
const ORIGINAL_BYTES_ESTIMATE = 1.1 * 1024 * 1024;

type Step = 'counting' | 'ready' | 'running' | 'done';

interface FailedItem {
  id: string;
  message: string;
}

interface ThumbnailBackfillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Albums to scan. One album, or every album of an event. */
  albumIds: string[];
  scopeLabel: string;
  /** Called once after a run that generated at least one thumbnail. */
  onGenerated: () => void;
}

function formatMegabytes(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
}

export default function ThumbnailBackfillDialog({
  open,
  onOpenChange,
  albumIds,
  scopeLabel,
  onGenerated,
}: ThumbnailBackfillDialogProps) {
  const [step, setStep] = useState<Step>('counting');
  const [pending, setPending] = useState<PhotoMissingThumbnail[]>([]);
  const [doneCount, setDoneCount] = useState(0);
  const [failed, setFailed] = useState<FailedItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const cancelledRef = useRef(false);

  const isRunning = step === 'running';

  const count = useCallback(async () => {
    setStep('counting');
    setLoadError('');
    setDoneCount(0);
    setFailed([]);
    try {
      setPending(await fetchPhotosMissingThumbnails(albumIds));
      setStep('ready');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not count photos');
      setStep('ready');
    }
  }, [albumIds]);

  useEffect(() => {
    if (!open) return;
    cancelledRef.current = false;
    count();
  }, [open, count]);

  useEffect(() => {
    if (!isRunning) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isRunning]);

  const start = async () => {
    if (pending.length === 0) return;
    setStep('running');
    cancelledRef.current = false;

    let cursor = 0;
    let generated = 0;

    const worker = async () => {
      while (cursor < pending.length && !cancelledRef.current) {
        const photo = pending[cursor++];
        try {
          await backfillPhotoThumbnail(photo);
          generated += 1;
          setDoneCount((n) => n + 1);
        } catch (error) {
          setFailed((list) => [
            ...list,
            { id: photo.id, message: error instanceof Error ? error.message : 'Failed' },
          ]);
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

    setStep('done');
    if (generated > 0) onGenerated();
  };

  const requestClose = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (isRunning) return; // Stop first; closing mid-run would orphan nothing, but it is confusing.
    onOpenChange(false);
  };

  const settled = doneCount + failed.length;
  const progress = pending.length ? Math.round((settled / pending.length) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        className="max-w-lg"
        onEscapeKeyDown={(event) => isRunning && event.preventDefault()}
        onInteractOutside={(event) => isRunning && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Generate missing thumbnails</DialogTitle>
          <DialogDescription>
            Small preview images for {scopeLabel}, so grids load quickly instead of
            downloading full-size photos.
          </DialogDescription>
        </DialogHeader>

        {step === 'counting' && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Counting photos without a thumbnail...
          </div>
        )}

        {loadError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {step === 'ready' && !loadError && (
          pending.length === 0 ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Every photo here already has a thumbnail.
            </div>
          ) : (
            <div className="space-y-2 py-2 text-sm">
              <p>
                <span className="font-medium">{pending.length}</span> {pending.length === 1 ? 'photo has' : 'photos have'} no
                thumbnail yet.
              </p>
              <p className="text-muted-foreground">
                Each original is downloaded once to make its thumbnail - about{' '}
                {formatMegabytes(pending.length * ORIGINAL_BYTES_ESTIMATE)} in total. Keep this tab open
                until it finishes; you can stop and resume later.
              </p>
            </div>
          )
        )}

        {(step === 'running' || step === 'done') && (
          <div className="space-y-3 py-2">
            <Progress value={progress} />
            <p className="text-sm text-muted-foreground">
              {doneCount} of {pending.length} generated
              {failed.length > 0 && <span className="text-destructive"> · {failed.length} failed</span>}
              {isRunning && cancelledRef.current && ' · stopping...'}
            </p>
            {failed.length > 0 && (
              <ScrollArea className="max-h-40 rounded-md border p-2">
                <ul className="space-y-1 text-xs">
                  {failed.map((item) => (
                    <li key={item.id} className="flex items-start gap-1.5 text-destructive">
                      <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                      <span className="break-all">{item.message}</span>
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            )}
            {step === 'done' && (
              <p className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                {failed.length === 0 ? 'Done.' : 'Done. Run again to retry the failed ones.'}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'ready' && (
            <>
              <Button variant="ghost" onClick={() => requestClose(false)}>
                Close
              </Button>
              <Button className="gap-2" onClick={start} disabled={pending.length === 0 || !!loadError}>
                <ImageDown className="h-4 w-4" />
                Generate {pending.length > 0 ? pending.length : ''}
              </Button>
            </>
          )}
          {isRunning && (
            <Button variant="outline" onClick={() => { cancelledRef.current = true; }} disabled={cancelledRef.current}>
              Stop after current photos
            </Button>
          )}
          {step === 'done' && (
            <Button onClick={() => requestClose(false)}>Close</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
