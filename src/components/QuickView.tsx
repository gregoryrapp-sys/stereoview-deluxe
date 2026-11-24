import { useCallback, useEffect, useRef, useState } from 'react';
import { Glasses, Loader2 } from 'lucide-react';
import SmartViewer from '@/components/SmartViewer';
import { toast } from '@/hooks/use-toast';
import { useViewerFullscreen } from '@/hooks/useViewerFullscreen';
import { exitPhotoFullscreen } from '@/lib/fullscreen';
import { ACCEPTED_TYPES, isAcceptedFile } from '@/lib/media';
import { isHeifFile } from '@/lib/spatial/heifBoxes';
import { convertSpatialToSbs } from '@/lib/spatial/convertSpatial';
import type { GalleryPhoto } from '@/services/galleryService';

/**
 * QuickView: look at side-by-side photos and videos straight from this
 * device, in the same viewer the albums use (zoom, pan, swipe, video
 * controls), without uploading anything.
 *
 * Meant for showing someone a picture just taken, or checking how a shot
 * looks before uploading it. Files are opened as blob: URLs and split in
 * memory only (never written to the eye cache); closing releases them.
 * Spatial HEICs are converted on the device, as at upload.
 *
 * Pictures straight off a camera can be stored right-eye first, so the
 * viewer gets a Flip L/R control here; the choice is remembered on this
 * device for the next QuickView.
 */

const FLIP_STORAGE_KEY = 'quickview-flip-eyes';

function readFlip(): boolean {
  try {
    return localStorage.getItem(FLIP_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeFlip(flipped: boolean) {
  try {
    localStorage.setItem(FLIP_STORAGE_KEY, flipped ? '1' : '0');
  } catch {
    // Private mode: the choice lasts for this QuickView only.
  }
}

interface LocalItem {
  id: string;
  /** blob: URL of the file (or of the converted side-by-side JPEG). */
  src: string;
  alt: string;
  /** Carries the file name, so the viewer can tell a video by its extension. */
  storagePath: string;
}

export default function QuickView() {
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<LocalItem[]>([]);
  const [index, setIndex] = useState<number | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [flipped, setFlipped] = useState(readFlip);

  const isOpen = index !== null && !!items[index];

  const releaseAll = useCallback((list: LocalItem[]) => {
    for (const item of list) URL.revokeObjectURL(item.src);
  }, []);

  const close = useCallback(async () => {
    await exitPhotoFullscreen();
    setIndex(null);
    setItems((current) => {
      releaseAll(current);
      return [];
    });
  }, [releaseAll]);

  useViewerFullscreen(isOpen, containerRef, () => void close());

  // Leaving the page with QuickView open still frees the files.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => () => releaseAll(itemsRef.current), [releaseAll]);

  const openFiles = async (files: FileList | null) => {
    const picked = Array.from(files ?? []);
    if (inputRef.current) inputRef.current.value = '';
    const accepted = picked.filter(isAcceptedFile);
    if (accepted.length === 0) {
      if (picked.length > 0) {
        toast({ title: 'Nothing to show', description: 'Choose side-by-side photos, spatial HEICs or videos (MP4/MOV).' });
      }
      return;
    }

    setPreparing(true);
    const next: LocalItem[] = [];
    let failed = 0;
    for (const file of accepted) {
      try {
        // A spatial HEIC becomes a side-by-side JPEG on the device, as at upload.
        const blob = isHeifFile(file) ? (await convertSpatialToSbs(file)).file : file;
        const name = isHeifFile(file) ? file.name.replace(/\.hei[cf]$/i, '.jpg') : file.name;
        const id = `quickview:${crypto.randomUUID()}`;
        next.push({ id, src: URL.createObjectURL(blob), alt: file.name, storagePath: `${id}/${name}` });
      } catch (error) {
        failed += 1;
        console.warn('QuickView could not open', file.name, error);
      }
    }
    setPreparing(false);

    if (failed > 0) {
      toast({
        title: `${failed} ${failed === 1 ? 'file' : 'files'} could not be opened`,
        description: 'Spatial HEICs need the original file (choose it through Files on iPhone).',
      });
    }
    if (next.length === 0) return;
    setItems(next);
    setIndex(0);
  };

  const toggleFlip = () => {
    setFlipped((current) => {
      writeFlip(!current);
      return !current;
    });
  };

  // The viewer reads left/right order from the photo's alignment, the same
  // field an album's "camera writes right-eye first" setting fills.
  const photos = items.map((item) => ({
    ...item,
    alignment: { dx: 0, dy: 0, swapped: flipped },
  })) as unknown as GalleryPhoto[];

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        className="hidden"
        onChange={(event) => void openFiles(event.target.files)}
      />

      {!isOpen && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={preparing}
          title="View side-by-side photos and videos from this device without uploading them"
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-40 flex items-center gap-2 rounded-full border border-border bg-background/90 px-4 py-2.5 text-sm font-medium text-foreground shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:bg-secondary disabled:opacity-70"
        >
          {preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Glasses className="h-4 w-4" />}
          {preparing ? 'Opening...' : 'QuickView'}
        </button>
      )}

      <div ref={containerRef} className={isOpen ? 'fixed inset-0 z-50 bg-black' : 'hidden'}>
        {isOpen && index !== null && (
          <SmartViewer
            photo={photos[index]}
            photos={photos}
            photoIndex={index}
            album={null}
            onClose={() => void close()}
            onPrevious={() => setIndex((i) => (i !== null && i > 0 ? i - 1 : i))}
            onNext={() => setIndex((i) => (i !== null && i < items.length - 1 ? i + 1 : i))}
            hasPrevious={index > 0}
            hasNext={index < items.length - 1}
            local
            onFlipEyes={toggleFlip}
            eyesFlipped={flipped}
          />
        )}
      </div>
    </>
  );
}
