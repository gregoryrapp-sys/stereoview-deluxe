import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Cloud, Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { SyncRunRecord } from '@/types/database';
import {
  applyDropboxSync,
  cancelDropboxSync,
  DropboxSyncError,
  dropboxSyncStatus,
  planDropboxSync,
  type SyncApplyResponse,
  type SyncPlanResponse,
  validateDropboxSync,
} from '@/services/dropboxSyncService';

/**
 * Import a Dropbox album into Storage, or re-sync one that already was.
 *
 * The preview is never skipped: the owner sees exactly what will be added,
 * updated, renamed, restored and removed - with covers about to disappear
 * called out, the projected storage use, and a typed confirmation when many
 * photos would be removed - before anything runs. Removal is soft; nothing a
 * photographer clicks here touches a storage object.
 *
 * A first import and a re-sync are the same flow: a never-synced album plans
 * as "N new, 0 removed".
 */

type Step =
  | { kind: 'checking' }
  | { kind: 'resumable'; run: SyncRunRecord }
  | { kind: 'validating' }
  | { kind: 'planning' }
  | { kind: 'preview'; plan: SyncPlanResponse }
  | { kind: 'applying'; runId: string; progress: SyncApplyResponse | null }
  | { kind: 'done'; result: SyncApplyResponse }
  | { kind: 'failed'; message: string; result?: SyncApplyResponse }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

interface DropboxSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  albumId: string;
  albumTitle: string;
  /** Called after a run finishes with photos changed, so the page reloads. */
  onSynced: () => void;
}

function mb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export default function DropboxSyncDialog({ open, onOpenChange, albumId, albumTitle, onSynced }: DropboxSyncDialogProps) {
  const [step, setStep] = useState<Step>({ kind: 'checking' });
  const [confirmation, setConfirmation] = useState('');
  const [confirmationError, setConfirmationError] = useState('');
  const stopRef = useRef(false);

  const isBusy = step.kind === 'applying' || step.kind === 'validating' || step.kind === 'planning' || step.kind === 'checking';

  const fail = (error: unknown) =>
    setStep({ kind: 'error', message: error instanceof Error ? error.message : 'Something went wrong' });

  const planNow = useCallback(async () => {
    try {
      setStep({ kind: 'validating' });
      const validation = await validateDropboxSync(albumId);
      // `=== false` rather than `!`: without strictNullChecks a truthiness test
      // does not narrow the union.
      if (validation.ok === false) {
        setStep({ kind: 'error', message: validation.message });
        return;
      }
      setStep({ kind: 'planning' });
      const plan = await planDropboxSync(albumId);
      setConfirmation('');
      setConfirmationError('');
      setStep({ kind: 'preview', plan });
    } catch (error) {
      fail(error);
    }
  }, [albumId]);

  useEffect(() => {
    if (!open) return;
    stopRef.current = false;
    (async () => {
      try {
        setStep({ kind: 'checking' });
        const status = await dropboxSyncStatus(albumId);
        if (status.active) {
          setStep({ kind: 'resumable', run: status.active });
          return;
        }
        await planNow();
      } catch (error) {
        fail(error);
      }
    })();
  }, [open, albumId, planNow]);

  useEffect(() => {
    if (step.kind !== 'applying') return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [step.kind]);

  const runApply = async (runId: string, typedConfirmation?: string) => {
    stopRef.current = false;
    setStep({ kind: 'applying', runId, progress: null });
    let changed = false;
    try {
      let result: SyncApplyResponse;
      // The server persists progress after every item; each call here is one
      // chunk. Stopping waits for the current chunk, then cancels the run.
      do {
        result = await applyDropboxSync(runId, typedConfirmation);
        setStep({ kind: 'applying', runId, progress: result });
        changed = changed || result.cursor > 0;
        if (stopRef.current && result.status === 'applying') {
          await cancelDropboxSync(runId);
          setStep({ kind: 'cancelled' });
          if (changed) onSynced();
          return;
        }
      } while (result.status === 'applying' || result.status === 'verifying');

      if (result.status === 'imported') {
        setStep({ kind: 'done', result });
        onSynced();
      } else if (result.status === 'cancelled') {
        setStep({ kind: 'cancelled' });
        if (changed) onSynced();
      } else {
        setStep({ kind: 'failed', message: result.error ?? 'The sync did not complete.', result });
        if (changed) onSynced();
      }
    } catch (error) {
      if (error instanceof DropboxSyncError && error.code === 'confirmation_required') {
        setConfirmationError(error.message);
        if (step.kind === 'applying') {
          // Back to the preview with the message; the plan is still valid.
          await planNow();
        }
        return;
      }
      if (changed) onSynced();
      fail(error);
    }
  };

  const discardResumable = async (runId: string) => {
    try {
      await cancelDropboxSync(runId);
      await planNow();
    } catch (error) {
      fail(error);
    }
  };

  const requestClose = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (step.kind === 'applying') return;
    onOpenChange(false);
  };

  const renderPreview = (plan: SyncPlanResponse) => {
    const { plan: p, storage, coversAffected } = plan;
    const hardRefusal = p.refusal?.code === 'empty_listing';
    const softRefusal = p.refusal && !hardRefusal;
    const canApply =
      !hardRefusal &&
      !storage.refusedForQuota &&
      (p.additions.length + p.updates.length + p.renames.length + p.restores.length + p.deletions.length > 0) &&
      (!p.requiresTypedConfirmation || confirmation.trim() === albumTitle.trim());

    const counts: Array<[string, number, string?]> = [
      ['new', p.additions.length],
      ['updated', p.updates.length],
      ['renamed', p.renames.length],
      ['restored', p.restores.length],
      ['removed', p.deletions.length, 'text-destructive'],
      ['unchanged', p.unchanged, 'text-muted-foreground'],
    ];

    return (
      <div className="space-y-4">
        {hardRefusal && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{p.refusal!.message}</span>
          </div>
        )}
        {softRefusal && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{p.refusal!.message}</span>
          </div>
        )}

        <dl className="grid grid-cols-3 gap-2 text-sm sm:grid-cols-6">
          {counts.map(([label, value, cls]) => (
            <div key={label} className="rounded-md bg-secondary/50 p-2 text-center">
              <dt className={`text-xs ${cls ?? 'text-muted-foreground'}`}>{label}</dt>
              <dd className={`text-lg font-medium ${cls ?? ''}`}>{value}</dd>
            </div>
          ))}
        </dl>

        <p className="text-sm text-muted-foreground">
          Adds about {mb(p.bytesToDownload)} · {mb(storage.quotaBytes - storage.usedBytes)} of {mb(storage.quotaBytes)} free
          {storage.refusedForQuota && (
            <span className="block font-medium text-destructive">
              Not enough space: this sync would exceed 90% of the storage quota. Import a smaller album or free space first.
            </span>
          )}
        </p>

        {p.skipped.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {p.skipped.length} {p.skipped.length === 1 ? 'file' : 'files'} skipped (not an image, too large, or no id).
          </p>
        )}

        {p.deletions.length > 0 && (
          <div className="space-y-2 rounded-md border border-destructive/30 p-3">
            <p className="text-sm font-medium text-destructive">
              {p.deletions.length} {p.deletions.length === 1 ? 'photo' : 'photos'} no longer in the Dropbox folder will be removed from the album
            </p>
            <p className="text-xs text-muted-foreground">
              Removed photos are hidden, not deleted - you can restore them from the album page.
            </p>
            {coversAffected.length > 0 && (
              <p className="text-xs font-medium text-destructive">
                Cover photos affected: {coversAffected.map((c) => `${c.name} (${c.level})`).join(', ')}
              </p>
            )}
            <ScrollArea className="max-h-32">
              <ul className="space-y-0.5 text-xs">
                {p.deletions.map((d) => (
                  <li key={d.photoId} className="truncate">{d.name}</li>
                ))}
              </ul>
            </ScrollArea>
            {p.requiresTypedConfirmation && (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="sync-confirm" className="text-xs">
                  That is a lot. Type the album name <span className="font-mono">{albumTitle}</span> to confirm.
                </Label>
                <Input
                  id="sync-confirm"
                  value={confirmation}
                  onChange={(e) => {
                    setConfirmation(e.target.value);
                    setConfirmationError('');
                  }}
                  autoComplete="off"
                />
                {confirmationError && <p className="text-xs text-destructive">{confirmationError}</p>}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => requestClose(false)}>
            Cancel
          </Button>
          <Button
            className="gap-2"
            disabled={!canApply}
            onClick={() => runApply(plan.runId, p.requiresTypedConfirmation ? confirmation : undefined)}
          >
            <RefreshCw className="h-4 w-4" />
            {p.additions.length > 0 && p.unchanged === 0 && p.updates.length === 0 ? 'Import' : 'Apply'}
          </Button>
        </DialogFooter>
      </div>
    );
  };

  const renderProgress = (progress: SyncApplyResponse | null, label: string) => {
    const total = progress?.total ?? 0;
    const cursor = progress?.cursor ?? 0;
    const percent = total ? Math.round((cursor / total) * 100) : 0;
    const a = progress?.applied;
    return (
      <div className="space-y-3">
        <Progress value={percent} />
        <p className="text-sm text-muted-foreground">
          {label} · {cursor} of {total}
          {a && (
            <>
              {' · '}
              {a.added} new, {a.updated} updated, {a.renamed} renamed, {a.restored} restored, {a.deleted} removed
              {a.thumbsMissing > 0 && `, ${a.thumbsMissing} without thumbnail`}
            </>
          )}
        </p>
        {progress && progress.errors.length > 0 && (
          <ScrollArea className="max-h-32 rounded-md border p-2">
            <ul className="space-y-1 text-xs text-destructive">
              {progress.errors.map((e, i) => (
                <li key={`${e.name}-${i}`} className="break-all">
                  {e.name}: {e.message} ({e.stage})
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        className="max-w-xl"
        onEscapeKeyDown={(event) => step.kind === 'applying' && event.preventDefault()}
        onInteractOutside={(event) => step.kind === 'applying' && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Cloud className="h-5 w-5 text-sky-500" />
            Sync with Dropbox
          </DialogTitle>
          <DialogDescription>
            Copies the photos in {albumTitle}'s Dropbox folder into the app and keeps them in step with it.
            Nothing is changed until you approve the preview.
          </DialogDescription>
        </DialogHeader>

        {(step.kind === 'checking' || step.kind === 'validating' || step.kind === 'planning') && (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {step.kind === 'checking' && 'Checking for a sync in progress...'}
            {step.kind === 'validating' && 'Reading the Dropbox folder...'}
            {step.kind === 'planning' && 'Comparing with the album...'}
          </div>
        )}

        {step.kind === 'resumable' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                A sync was started earlier and stopped at {step.run.cursor} of {step.run.total_items}. Resume it, or
                discard it and plan again.
              </span>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => discardResumable(step.run.id)}>
                Discard
              </Button>
              <Button className="gap-2" onClick={() => runApply(step.run.id)}>
                <RefreshCw className="h-4 w-4" />
                Resume
              </Button>
            </DialogFooter>
          </div>
        )}

        {step.kind === 'preview' && renderPreview(step.plan)}

        {step.kind === 'applying' && (
          <div className="space-y-4">
            {renderProgress(step.progress, step.progress?.status === 'verifying' ? 'Checking counts and covers' : 'Importing')}
            <DialogFooter>
              <Button variant="outline" onClick={() => { stopRef.current = true; }} disabled={stopRef.current}>
                {stopRef.current ? 'Stopping after this batch...' : 'Stop'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step.kind === 'done' && (
          <div className="space-y-4">
            {renderProgress(step.result, 'Done')}
            <p className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              This album now serves from the app. Re-run Sync any time the Dropbox folder changes.
            </p>
            {step.result.applied.thumbsMissing > 0 && (
              <p className="text-xs text-muted-foreground">
                {step.result.applied.thumbsMissing} thumbnails could not be generated by Dropbox; use "Generate
                missing thumbnails" to fill them in.
              </p>
            )}
            {step.result.unresolvedCovers && step.result.unresolvedCovers.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Covers that could not be matched to an imported photo: {step.result.unresolvedCovers.join(', ')}. Pick
                a new cover from the album.
              </p>
            )}
            <DialogFooter>
              <Button onClick={() => requestClose(false)}>Close</Button>
            </DialogFooter>
          </div>
        )}

        {step.kind === 'failed' && (
          <div className="space-y-4">
            {step.result && renderProgress(step.result, 'Stopped')}
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{step.message}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Nothing was marked as imported. Photos that did copy are kept; planning again will pick up where this left off.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => requestClose(false)}>
                Close
              </Button>
              <Button onClick={planNow}>Plan again</Button>
            </DialogFooter>
          </div>
        )}

        {step.kind === 'cancelled' && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Stopped. Photos already copied are kept; plan again to continue.</p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => requestClose(false)}>
                Close
              </Button>
              <Button onClick={planNow}>Plan again</Button>
            </DialogFooter>
          </div>
        )}

        {step.kind === 'error' && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{step.message}</span>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => requestClose(false)}>
                Close
              </Button>
              <Button onClick={planNow}>Try again</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
