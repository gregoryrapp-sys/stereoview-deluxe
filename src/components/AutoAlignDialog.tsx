import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Crosshair, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { applyEstimate, estimateFileAlignment, STORE_MIN_CONFIDENCE } from '@/lib/stereoAlign/estimateForImage';
import {
  fetchPhotosForAlignment,
  type PhotoForAlignment,
  signedOriginalUrl,
  updatePhotoAlignment,
} from '@/services/galleryService';

/**
 * Runs the alignment estimator over an album (or every upload album of an
 * event) in the owner's browser: download each original once, estimate the
 * offset and the left/right order, store it when confident. A flip is applied
 * only when the depth cue is clear (the photographer's rule: unsure = leave it).
 *
 * Manual alignments (set in the viewer, version 0) are left alone unless the
 * owner explicitly asks to redo them.
 */

const CONCURRENCY = 2;

type Step = 'counting' | 'ready' | 'running' | 'done';

interface Outcome {
  stored: number;
  lowConfidence: number;
  flipped: number;
  rotation: number;
  failed: Array<{ id: string; message: string }>;
}

const EMPTY_OUTCOME: Outcome = { stored: 0, lowConfidence: 0, flipped: 0, rotation: 0, failed: [] };

interface AutoAlignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  albumIds: string[];
  scopeLabel: string;
  /** lr_swapped_default per album, so estimation runs in the displayed order. */
  albumSwapDefaults: Record<string, boolean>;
  onAligned: () => void;
}

export default function AutoAlignDialog({
  open,
  onOpenChange,
  albumIds,
  scopeLabel,
  albumSwapDefaults,
  onAligned,
}: AutoAlignDialogProps) {
  const [step, setStep] = useState<Step>('counting');
  const [pending, setPending] = useState<PhotoForAlignment[]>([]);
  const [redoEstimates, setRedoEstimates] = useState(false);
  const [done, setDone] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>(EMPTY_OUTCOME);
  const [loadError, setLoadError] = useState('');
  const cancelledRef = useRef(false);

  const isRunning = step === 'running';

  const count = useCallback(async () => {
    setStep('counting');
    setLoadError('');
    setDone(0);
    setOutcome(EMPTY_OUTCOME);
    try {
      setPending(await fetchPhotosForAlignment(albumIds, { includeAligned: redoEstimates }));
      setStep('ready');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Could not count photos');
      setStep('ready');
    }
  }, [albumIds, redoEstimates]);

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
    const tally: Outcome = { ...EMPTY_OUTCOME, failed: [] };
    let cursor = 0;

    const worker = async () => {
      while (cursor < pending.length && !cancelledRef.current) {
        const photo = pending[cursor++];
        try {
          const url = await signedOriginalUrl(photo.storage_path);
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
          const swapped = photo.lr_swapped ?? albumSwapDefaults[photo.album_id] ?? false;
          const est = await estimateFileAlignment(await response.blob(), { swapped });

          if (est.rotationSuspected) tally.rotation += 1;

          if (est.confidence >= STORE_MIN_CONFIDENCE) {
            const alignment = applyEstimate(est, swapped);
            await updatePhotoAlignment({
              photoId: photo.id,
              alignment,
              version: est.version,
              confidence: est.confidence,
            });
            tally.stored += 1;
            if (alignment.swapped !== swapped) tally.flipped += 1;
          } else {
            tally.lowConfidence += 1;
          }
        } catch (error) {
          tally.failed.push({ id: photo.id, message: error instanceof Error ? error.message : 'Failed' });
        }
        setDone((n) => n + 1);
        setOutcome({ ...tally, failed: [...tally.failed] });
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));
    setStep('done');
    if (tally.stored > 0) onAligned();
  };

  const requestClose = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (isRunning) return;
    onOpenChange(false);
  };

  const progress = pending.length ? Math.round((done / pending.length) * 100) : 0;

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        className="max-w-lg"
        onEscapeKeyDown={(event) => isRunning && event.preventDefault()}
        onInteractOutside={(event) => isRunning && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crosshair className="h-5 w-5" />
            Auto-align
          </DialogTitle>
          <DialogDescription>
            Measures the misalignment between the two eyes of each photo in {scopeLabel}, corrects the
            left/right order when the photo clearly shows it, and saves the result. Photos are not modified;
            the viewer applies the correction when it splits them.
          </DialogDescription>
        </DialogHeader>

        {step === 'counting' && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Counting photos...
          </div>
        )}

        {loadError && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {step === 'ready' && !loadError && (
          <div className="space-y-3 py-2 text-sm">
            {pending.length === 0 ? (
              <p className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                {redoEstimates ? 'Nothing to redo.' : 'Every photo here already has an alignment.'}
              </p>
            ) : (
              <p>
                <span className="font-medium">{pending.length}</span> {pending.length === 1 ? 'photo' : 'photos'} to
                measure. Each original is downloaded once (about {Math.max(1, Math.round((pending.length * 1.1)))} MB).
              </p>
            )}
            <div className="flex items-start gap-2">
              <Checkbox id="redo-estimates" checked={redoEstimates} onCheckedChange={(v) => setRedoEstimates(v === true)} className="mt-0.5" />
              <Label htmlFor="redo-estimates" className="text-xs font-normal text-muted-foreground">
                Also redo photos aligned automatically before. Alignments set by hand in the viewer are never touched.
              </Label>
            </div>
            <p className="text-xs text-muted-foreground">
              Left/right order is corrected automatically when the photo clearly shows it; otherwise it is left
              as uploaded.
            </p>
          </div>
        )}

        {(step === 'running' || step === 'done') && (
          <div className="space-y-3 py-2">
            <Progress value={progress} />
            <p className="text-sm text-muted-foreground">
              {done} of {pending.length} measured · {outcome.stored} saved
              {outcome.lowConfidence > 0 && ` · ${outcome.lowConfidence} unsure (left unchanged)`}
              {outcome.flipped > 0 && ` · ${outcome.flipped} flipped L/R`}
              {outcome.rotation > 0 && ` · ${outcome.rotation} with rotation`}
              {outcome.failed.length > 0 && <span className="text-destructive"> · {outcome.failed.length} failed</span>}
            </p>
            {outcome.failed.length > 0 && (
              <ScrollArea className="max-h-32 rounded-md border p-2">
                <ul className="space-y-1 text-xs text-destructive">
                  {outcome.failed.map((f) => (
                    <li key={f.id} className="break-all">{f.message}</li>
                  ))}
                </ul>
              </ScrollArea>
            )}
            {step === 'done' && (
              <p className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Done. Open a photo and pinch to 500% to check the result; Align mode lets you fine-tune.
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
                <Crosshair className="h-4 w-4" />
                Measure {pending.length > 0 ? pending.length : ''}
              </Button>
            </>
          )}
          {isRunning && (
            <Button variant="outline" onClick={() => { cancelledRef.current = true; }} disabled={cancelledRef.current}>
              Stop after current photos
            </Button>
          )}
          {step === 'done' && <Button onClick={() => requestClose(false)}>Close</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
