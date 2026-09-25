import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { uploadSbsPhoto } from '@/services/galleryService';
import { applyEstimate, estimateFileAlignment, STORE_MIN_CONFIDENCE } from '@/lib/stereoAlign/estimateForImage';
import { convertSpatialToSbs } from '@/lib/spatial/convertSpatial';
import { isHeifFile } from '@/lib/spatial/heifBoxes';

/**
 * Guided upload flow for an album.
 *
 * This replaces an inline form that sat next to "Save Album" and shared nothing
 * with it. Selecting files and then clicking Save uploaded nothing and warned
 * about nothing - the selection was simply dropped. Owning the pending files
 * inside a modal makes that failure structurally impossible rather than something
 * to warn about, and it keeps the workflow contained without needing router-level
 * navigation blocking (which would mean migrating the app to a data router purely
 * to use useBlocker).
 */

/** `converting` is the spatial-HEIC step: both eyes are decoded into an SBS JPEG before upload. */
type UploadStatus = 'pending' | 'converting' | 'uploading' | 'done' | 'failed';

interface QueuedFile {
  id: string;
  file: File;
  status: UploadStatus;
  error?: string;
}

type Step = 'select' | 'uploading' | 'summary';

/** Uploads run a few at a time; sequential was needlessly slow for large batches. */
const UPLOAD_CONCURRENCY = 3;

/**
 * Apple Spatial Photos arrive as .HEIC and are converted in the browser; the
 * extension entries matter because Safari and Chrome disagree on the MIME type
 * a picker reports for HEIC.
 */
const ACCEPTED_TYPES = 'image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface AlbumUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  albumId: string;
  albumTitle: string;
  eventId: string;
  ownerId: string;
  /** The album's camera writes right-eye-first; alignment is measured in that order. */
  albumSwappedDefault?: boolean;
  /** Called once after a run that uploaded at least one photo, so the page can refresh. */
  onUploaded: () => void;
}

export default function AlbumUploadDialog({
  open,
  onOpenChange,
  albumId,
  albumTitle,
  eventId,
  ownerId,
  albumSwappedDefault = false,
  onUploaded,
}: AlbumUploadDialogProps) {
  const [queue, setQueue] = useState<QueuedFile[]>([]);
  const [namePrefix, setNamePrefix] = useState('');
  const [autoAlign, setAutoAlign] = useState(true);
  const [step, setStep] = useState<Step>('select');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isUploading = step === 'uploading';

  const counts = useMemo(() => {
    const done = queue.filter((item) => item.status === 'done').length;
    const failed = queue.filter((item) => item.status === 'failed').length;
    return { done, failed, total: queue.length, settled: done + failed };
  }, [queue]);

  const totalBytes = useMemo(
    () => queue.reduce((sum, item) => sum + item.file.size, 0),
    [queue],
  );

  const reset = useCallback(() => {
    setQueue([]);
    setNamePrefix('');
    setStep('select');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // Browser refresh/close during an active upload. In-app navigation is covered
  // by the dialog itself, which cannot be dismissed while uploading.
  useEffect(() => {
    if (!isUploading) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isUploading]);

  const addFiles = (files: FileList | null) => {
    if (!files?.length) return;
    setQueue((current) => [
      ...current,
      ...Array.from(files).map((file) => ({
        id: `${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID()}`,
        file,
        status: 'pending' as const,
      })),
    ]);
  };

  const removeFile = (id: string) => {
    setQueue((current) => current.filter((item) => item.id !== id));
  };

  const setStatus = (id: string, status: UploadStatus, error?: string) => {
    setQueue((current) =>
      current.map((item) => (item.id === id ? { ...item, status, error } : item)),
    );
  };

  const startUpload = async () => {
    if (queue.length === 0) return;
    setStep('uploading');

    // Snapshot the order now so the index used for prefix naming is stable even
    // though queue state is being mutated as uploads settle.
    const batch = queue.map((item, index) => ({ item, index }));
    let cursor = 0;

    const worker = async () => {
      while (cursor < batch.length) {
        const { item, index } = batch[cursor++];
        try {
          // A spatial HEIC becomes an ordinary side-by-side JPEG first; from
          // here on nothing downstream knows it was ever anything else.
          let file = item.file;
          if (isHeifFile(file)) {
            setStatus(item.id, 'converting');
            file = (await convertSpatialToSbs(file)).file;
          }
          setStatus(item.id, 'uploading');

          // Measure alignment and left/right order while the file is in hand.
          // The decode dominates and uploads already run a few at a time; a
          // failed or unsure measurement stores nothing rather than a guess.
          const estimate = autoAlign
            ? await estimateFileAlignment(file, { swapped: albumSwappedDefault }).catch(() => null)
            : null;

          await uploadSbsPhoto({
            albumId,
            eventId,
            ownerId,
            file,
            alt: namePrefix
              ? `${namePrefix} ${index + 1}`
              : item.file.name.replace(/\.[^.]+$/, ''),
            alignment:
              estimate && estimate.confidence >= STORE_MIN_CONFIDENCE
                ? {
                    alignment: applyEstimate(estimate, albumSwappedDefault),
                    version: estimate.version,
                    confidence: estimate.confidence,
                  }
                : null,
          });
          setStatus(item.id, 'done');
        } catch (error) {
          // One bad file must not abandon the rest of the batch. The old loop
          // threw on the first failure and left the album half uploaded with no
          // record of which files had made it.
          setStatus(item.id, 'failed', error instanceof Error ? error.message : 'Upload failed');
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(UPLOAD_CONCURRENCY, batch.length) }, worker),
    );

    setStep('summary');
    onUploaded();
  };

  const requestClose = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true);
      return;
    }
    if (isUploading) return;

    const hasUnsent = queue.some((item) => item.status === 'pending');
    if (hasUnsent && !window.confirm('Discard the selected photos without uploading?')) {
      return;
    }

    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent
        className="max-w-lg"
        // Escape and outside clicks must not abandon an upload in flight.
        onEscapeKeyDown={(event) => isUploading && event.preventDefault()}
        onInteractOutside={(event) => isUploading && event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Upload photos</DialogTitle>
          <DialogDescription>
            Add side-by-side stereo images or Apple spatial photos (.HEIC) to {albumTitle}. You
            can select several files at once.
          </DialogDescription>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="album-upload-files">Choose files</Label>
              <Input
                id="album-upload-files"
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                multiple
                onChange={(event) => {
                  addFiles(event.target.files);
                  // Allow re-picking the same file after removing it from the list.
                  event.target.value = '';
                }}
              />
            </div>

            {queue.length > 0 && (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {queue.length} {queue.length === 1 ? 'photo' : 'photos'} ready
                  </span>
                  <span className="text-muted-foreground">{formatBytes(totalBytes)}</span>
                </div>

                <ScrollArea className="h-48 rounded-md border">
                  <ul className="divide-y">
                    {queue.map((item) => (
                      <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                        <ImagePlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">{item.file.name}</span>
                        {isHeifFile(item.file) && (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Spatial
                          </span>
                        )}
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatBytes(item.file.size)}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeFile(item.id)}
                          aria-label={`Remove ${item.file.name}`}
                          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>

                {queue.some((item) => isHeifFile(item.file)) && (
                  <p className="text-xs text-muted-foreground">
                    Spatial photos are opened in your browser, both eyes are placed side by side, and
                    the result is uploaded as a normal stereo JPEG. Nothing is sent anywhere for
                    conversion.
                  </p>
                )}

                <div className="space-y-2">
                  <Label htmlFor="album-upload-prefix">Name prefix (optional)</Label>
                  <Input
                    id="album-upload-prefix"
                    value={namePrefix}
                    placeholder="Leave blank to keep the original file names"
                    onChange={(event) => setNamePrefix(event.target.value)}
                  />
                </div>

                <div className="flex items-start gap-2">
                  <Checkbox
                    id="album-upload-autoalign"
                    checked={autoAlign}
                    onCheckedChange={(value) => setAutoAlign(value === true)}
                    className="mt-0.5"
                  />
                  <Label htmlFor="album-upload-autoalign" className="text-xs font-normal text-muted-foreground">
                    Auto-align on upload: measure the offset between the two eyes, correct the left/right
                    order when the photo clearly shows it, and save the result. Photos are not modified.
                    {albumSwappedDefault && ' This album shows photos with L/R swapped.'}
                  </Label>
                </div>
              </>
            )}
          </div>
        )}

        {step === 'uploading' && (
          <div className="space-y-4">
            <Progress value={(counts.settled / Math.max(counts.total, 1)) * 100} />
            <p className="text-sm text-muted-foreground">
              Uploading {Math.min(counts.settled + 1, counts.total)} of {counts.total}. Leave
              this window open until it finishes.
            </p>
            <ScrollArea className="h-48 rounded-md border">
              <ul className="divide-y">
                {queue.map((item) => (
                  <li key={item.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                    {(item.status === 'uploading' || item.status === 'converting') && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                    )}
                    {item.status === 'done' && (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                    )}
                    {item.status === 'failed' && (
                      <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
                    )}
                    {item.status === 'pending' && (
                      <ImagePlus className="h-4 w-4 shrink-0 text-muted-foreground/40" />
                    )}
                    <span
                      className={cn(
                        'min-w-0 flex-1 truncate',
                        item.status === 'pending' && 'text-muted-foreground',
                      )}
                    >
                      {item.file.name}
                    </span>
                    {item.status === 'converting' && (
                      <span className="shrink-0 text-xs text-muted-foreground">converting spatial photo</span>
                    )}
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        )}

        {step === 'summary' && (
          <div className="space-y-3">
            <p className="text-sm">
              {counts.done} of {counts.total} {counts.total === 1 ? 'photo' : 'photos'}{' '}
              uploaded.
            </p>
            {counts.failed > 0 && (
              <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">
                  {counts.failed} failed. The rest were uploaded successfully.
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {queue
                    .filter((item) => item.status === 'failed')
                    .map((item) => (
                      <li key={item.id}>
                        <span className="font-medium">{item.file.name}</span> - {item.error}
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {step === 'select' && (
            <>
              <Button variant="ghost" onClick={() => requestClose(false)}>
                Cancel
              </Button>
              <Button onClick={startUpload} disabled={queue.length === 0} className="gap-2">
                <Upload className="h-4 w-4" />
                Upload {queue.length > 0 && `${queue.length} `}
                {queue.length === 1 ? 'photo' : 'photos'}
              </Button>
            </>
          )}

          {step === 'uploading' && (
            <Button disabled className="gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading...
            </Button>
          )}

          {step === 'summary' && (
            <>
              {counts.failed > 0 && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    // Retry only what failed, keeping the successful uploads out of the way.
                    setQueue((current) =>
                      current
                        .filter((item) => item.status === 'failed')
                        .map((item) => ({ ...item, status: 'pending' as const, error: undefined })),
                    );
                    setStep('select');
                  }}
                >
                  Retry failed
                </Button>
              )}
              <Button
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
              >
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
