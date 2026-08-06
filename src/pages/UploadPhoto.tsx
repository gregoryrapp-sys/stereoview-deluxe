import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Cloud, Folder, FolderOpen, Images, Upload, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  fetchGalleryData,
  GalleryData,
  uploadStereoPairPhoto,
  UploadImageSource,
} from '@/services/galleryService';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

type UploadMethod = 'single-folder' | 'separate-folders' | 'single-pair' | 'dropbox-urls';

interface UploadSourceItem {
  key: string;
  name: string;
  label: string;
  source: UploadImageSource;
}

interface StereoPairCandidate {
  key: string;
  name: string;
  left: UploadSourceItem;
  right: UploadSourceItem;
}

interface ParsedStereoItem extends UploadSourceItem {
  side: 'left' | 'right';
}

function getFilePath(file: File) {
  return file.webkitRelativePath || file.name;
}

function getFileExtension(fileName: string) {
  return fileName.split('?')[0].split('#')[0].split('.').pop()?.toLowerCase() ?? '';
}

function isSupportedImageName(fileName: string) {
  return IMAGE_EXTENSIONS.has(getFileExtension(fileName));
}

function normalizePairName(value: string) {
  return value.replace(/[_\-. ]+/g, ' ').trim();
}

function markerToSide(marker: string): 'left' | 'right' {
  return marker.toLowerCase().startsWith('r') ? 'right' : 'left';
}

function fileToItem(file: File, path = getFilePath(file)): UploadSourceItem {
  const fileName = path.split('/').pop() ?? file.name;
  const stem = fileName.replace(/\.[^.]+$/, '');

  return {
    key: path.toLowerCase(),
    name: normalizePairName(stem),
    label: path,
    source: { kind: 'file', file },
  };
}

function stripTopFolder(path: string) {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts.length > 1 ? parts.slice(1).join('/') : path;
}

function parseSideMarkedItem(item: UploadSourceItem): ParsedStereoItem | null {
  if (!isSupportedImageName(item.label)) return null;

  const path = item.label.replace(/\\/g, '/');
  const parts = path.split('/');
  const fileName = parts.pop() ?? item.label;
  const stem = fileName.replace(/\.[^.]+$/, '');
  const directories = parts;
  const sideDirectoryIndex = directories.findIndex((part) => /^(left|right|l|r)$/i.test(part));

  if (sideDirectoryIndex >= 0) {
    const side = markerToSide(directories[sideDirectoryIndex]);
    const keyDirectories = directories.filter((_, index) => index !== sideDirectoryIndex);
    const key = [...keyDirectories, stem].join('/').toLowerCase();

    return { ...item, key, name: normalizePairName(stem), side };
  }

  const suffixMatch = stem.match(/^(.*?)[_\-. ]+(left|right|l|r)$/i);
  if (suffixMatch) {
    return {
      ...item,
      key: [...directories, suffixMatch[1]].join('/').toLowerCase(),
      name: normalizePairName(suffixMatch[1]),
      side: markerToSide(suffixMatch[2]),
    };
  }

  const prefixMatch = stem.match(/^(left|right|l|r)[_\-. ]+(.*)$/i);
  if (prefixMatch) {
    return {
      ...item,
      key: [...directories, prefixMatch[2]].join('/').toLowerCase(),
      name: normalizePairName(prefixMatch[2]),
      side: markerToSide(prefixMatch[1]),
    };
  }

  return null;
}

function pairSideMarkedItems(items: UploadSourceItem[]) {
  const groups = new Map<string, { name: string; left?: UploadSourceItem; right?: UploadSourceItem; extras: string[] }>();
  const unmatched: string[] = [];

  items.forEach((item) => {
    const parsed = parseSideMarkedItem(item);

    if (!parsed) {
      unmatched.push(item.label);
      return;
    }

    const group = groups.get(parsed.key) ?? { name: parsed.name, extras: [] };
    if (parsed.side === 'left') {
      if (group.left) group.extras.push(item.label);
      else group.left = parsed;
    } else if (group.right) {
      group.extras.push(item.label);
    } else {
      group.right = parsed;
    }

    groups.set(parsed.key, group);
  });

  const pairs: StereoPairCandidate[] = [];

  groups.forEach((group, key) => {
    if (group.left && group.right) {
      pairs.push({ key, name: group.name, left: group.left, right: group.right });
    } else {
      unmatched.push(...[group.left?.label, group.right?.label, ...group.extras].filter((label): label is string => !!label));
    }
  });

  return {
    pairs: pairs.sort((a, b) => a.name.localeCompare(b.name)),
    unmatched: unmatched.sort((a, b) => a.localeCompare(b)),
  };
}

function pairSeparateFolders(leftFiles: File[], rightFiles: File[]) {
  const rightItems = new Map<string, UploadSourceItem>();
  const unmatched: string[] = [];

  rightFiles.forEach((file) => {
    const relativePath = stripTopFolder(getFilePath(file));
    const key = relativePath.toLowerCase();
    rightItems.set(key, fileToItem(file, relativePath));
  });

  const pairs: StereoPairCandidate[] = [];

  leftFiles.forEach((file) => {
    const relativePath = stripTopFolder(getFilePath(file));
    const key = relativePath.toLowerCase();
    const right = rightItems.get(key);

    if (!right) {
      unmatched.push(getFilePath(file));
      return;
    }

    const left = fileToItem(file, relativePath);
    const name = normalizePairName(relativePath.replace(/\.[^.]+$/, ''));
    pairs.push({ key, name, left, right });
    rightItems.delete(key);
  });

  rightItems.forEach((item) => unmatched.push(item.label));

  return {
    pairs: pairs.sort((a, b) => a.name.localeCompare(b.name)),
    unmatched: unmatched.sort((a, b) => a.localeCompare(b)),
  };
}

function normalizeDropboxUrl(value: string) {
  try {
    const url = new URL(value.trim());

    if (url.hostname.includes('dropbox.com')) {
      url.hostname = 'dl.dropboxusercontent.com';
      url.search = '';
    }

    return url.toString();
  } catch {
    return value.trim();
  }
}

function fileNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    const pathName = decodeURIComponent(url.pathname);
    return pathName.split('/').filter(Boolean).pop() ?? value;
  } catch {
    return value.split('/').pop() ?? value;
  }
}

function pairDropboxUrls(value: string) {
  const items = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((url) => {
      const directUrl = normalizeDropboxUrl(url);
      const fileName = fileNameFromUrl(directUrl);

      return {
        key: fileName.toLowerCase(),
        name: normalizePairName(fileName.replace(/\.[^.]+$/, '')),
        label: fileName,
        source: { kind: 'url', url: directUrl, fileName } satisfies UploadImageSource,
      };
    });

  return pairSideMarkedItems(items);
}

const folderInputProps = {
  webkitdirectory: '',
  directory: '',
} as React.InputHTMLAttributes<HTMLInputElement> & {
  webkitdirectory: string;
  directory: string;
};

interface SinglePairImagePickerProps {
  id: string;
  label: string;
  file: File | null;
  disabled: boolean;
  onChange: (file: File | null) => void;
}

function SinglePairImagePicker({ id, label, file, disabled, onChange }: SinglePairImagePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
        className="group flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-secondary text-left transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
      >
        {previewUrl ? (
          <div className="relative h-full w-full">
            <img src={previewUrl} alt={`${label} preview`} className="h-full w-full object-cover" />
            <span
              role="button"
              tabIndex={0}
              aria-label={`Clear ${label.toLowerCase()}`}
              onClick={(event) => {
                event.stopPropagation();
                onChange(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange(null);
                }
              }}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded bg-background/90 text-foreground shadow-sm transition-colors hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </span>
            <div className="absolute inset-x-0 bottom-0 bg-background/85 px-3 py-2 text-xs text-foreground backdrop-blur-sm">
              <p className="truncate font-medium">{file?.name}</p>
              <p className="text-muted-foreground">Click to replace</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 text-center text-sm text-muted-foreground">
            <Images className="h-8 w-8" />
            <span>Select {label.toLowerCase()}</span>
          </div>
        )}
      </button>
      <Input
        ref={inputRef}
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          onChange(event.target.files?.[0] ?? null);
          event.target.value = '';
        }}
        disabled={disabled}
      />
    </div>
  );
}

export default function UploadPhoto() {
  const { isAuthenticated, isLoading: isAuthLoading, user } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [galleryData, setGalleryData] = useState<GalleryData>({ events: [], albums: [], photos: [] });
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedAlbumId, setSelectedAlbumId] = useState('');
  const [photoName, setPhotoName] = useState('');
  const [uploadMethod, setUploadMethod] = useState<UploadMethod>('single-folder');
  const [matchedPairs, setMatchedPairs] = useState<StereoPairCandidate[]>([]);
  const [unmatchedItems, setUnmatchedItems] = useState<string[]>([]);
  const [leftFolderFiles, setLeftFolderFiles] = useState<File[]>([]);
  const [rightFolderFiles, setRightFolderFiles] = useState<File[]>([]);
  const [singleLeftFile, setSingleLeftFile] = useState<File | null>(null);
  const [singleRightFile, setSingleRightFile] = useState<File | null>(null);
  const [dropboxUrls, setDropboxUrls] = useState('');
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  const selectedEvent = useMemo(
    () => galleryData.events.find((event) => event.id === selectedEventId) ?? null,
    [galleryData.events, selectedEventId],
  );

  const albumsForSelectedEvent = useMemo(
    () => galleryData.albums.filter((album) => album.event_id === selectedEventId),
    [galleryData.albums, selectedEventId],
  );

  const selectedAlbum = useMemo(
    () => galleryData.albums.find((album) => album.id === selectedAlbumId) ?? null,
    [galleryData.albums, selectedAlbumId],
  );
  
  const isUploadDisabledForAlbum = useMemo(
    () => selectedAlbum?.source_type === 'dropbox',
    [selectedAlbum]
  );

  const loadData = useCallback(() => {
    let cancelled = false;

    async function run() {
      setIsLoadingData(true);

      try {
        const data = await fetchGalleryData();
        if (cancelled) return;

        const eventFromQuery = searchParams.get('event');
        const albumFromQuery = searchParams.get('album');
        const firstEvent = data.events[0];
        const initialEvent = data.events.find((event) => event.id === eventFromQuery) ?? firstEvent;
        const initialAlbums = data.albums.filter((album) => album.event_id === initialEvent?.id);
        const initialAlbum =
          data.albums.find((album) => album.id === albumFromQuery && album.event_id === initialEvent?.id) ??
          initialAlbums[0];

        setGalleryData(data);
        setSelectedEventId(initialEvent?.id ?? '');
        setSelectedAlbumId(initialAlbum?.id ?? '');

        if (data.events.length === 0 || data.albums.length === 0) {
          toast({
            title: 'Create a destination first',
            description: 'Photos can only be uploaded into existing events and albums.',
          });
          navigate('/manage?reason=missing-destination');
        }
      } catch (error) {
        toast({
          title: 'Could not load events',
          description: error instanceof Error ? error.message : 'Supabase data failed to load',
          variant: 'destructive',
        });
      } finally {
        if (!cancelled) setIsLoadingData(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [navigate, searchParams]);

  useEffect(() => {
    if (!isAuthenticated) return;
    return loadData();
  }, [isAuthenticated, loadData]);

  useEffect(() => {
    if (!selectedEventId) {
      setSelectedAlbumId('');
      return;
    }

    if (selectedAlbumId && !albumsForSelectedEvent.some((album) => album.id === selectedAlbumId)) {
      setSelectedAlbumId(albumsForSelectedEvent[0]?.id ?? '');
    }
  }, [albumsForSelectedEvent, selectedAlbumId, selectedEventId]);

  const resetDetectedPairs = () => {
    setMatchedPairs([]);
    setUnmatchedItems([]);
  };

  const handleMethodChange = (method: UploadMethod) => {
    setUploadMethod(method);
    resetDetectedPairs();
    setLeftFolderFiles([]);
    setRightFolderFiles([]);
    setSingleLeftFile(null);
    setSingleRightFile(null);
    setDropboxUrls('');
  };

  const handleSingleFolderSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const items = Array.from(event.target.files ?? []).map((file) => fileToItem(file));
    const { pairs, unmatched } = pairSideMarkedItems(items);
    setMatchedPairs(pairs);
    setUnmatchedItems(unmatched);
  };

  const handleLeftFolderSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    setLeftFolderFiles(files);
    const { pairs, unmatched } = pairSeparateFolders(files, rightFolderFiles);
    setMatchedPairs(pairs);
    setUnmatchedItems(unmatched);
  };

  const handleRightFolderSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    setRightFolderFiles(files);
    const { pairs, unmatched } = pairSeparateFolders(leftFolderFiles, files);
    setMatchedPairs(pairs);
    setUnmatchedItems(unmatched);
  };

  const handleSinglePairChange = (side: 'left' | 'right', file: File | null) => {
    const nextLeft = side === 'left' ? file : singleLeftFile;
    const nextRight = side === 'right' ? file : singleRightFile;

    setSingleLeftFile(nextLeft);
    setSingleRightFile(nextRight);
    setUnmatchedItems([]);

    if (nextLeft && nextRight) {
      const pairName = normalizePairName(photoName || nextLeft.name.replace(/\.[^.]+$/, '') || 'stereo photo');
      setMatchedPairs([
        {
          key: 'single-pair',
          name: pairName,
          left: fileToItem(nextLeft, nextLeft.name),
          right: fileToItem(nextRight, nextRight.name),
        },
      ]);
    } else {
      setMatchedPairs([]);
    }
  };

  const handleDropboxUrlsChange = (value: string) => {
    setDropboxUrls(value);
    const { pairs, unmatched } = pairDropboxUrls(value);
    setMatchedPairs(pairs);
    setUnmatchedItems(unmatched);
  };

  if (isAuthLoading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!user || matchedPairs.length === 0) return;

    setIsSubmitting(true);
    setUploadProgress('');

    try {
      if (!selectedEvent) {
        throw new Error('Choose an event');
      }

      if (!selectedAlbum) {
        throw new Error('Choose an album');
      }

      for (const [index, pair] of matchedPairs.entries()) {
        setUploadProgress(`Uploading ${index + 1} of ${matchedPairs.length}`);

        await uploadStereoPairPhoto({
          albumId: selectedAlbum.id,
          eventId: selectedEvent.id,
          ownerId: selectedEvent.owner_id,
          leftSource: pair.left.source,
          rightSource: pair.right.source,
          alt: photoName ? `${photoName} ${index + 1}` : pair.name,
        });
      }

      toast({ title: matchedPairs.length === 1 ? 'Photo uploaded' : `${matchedPairs.length} photos uploaded` });
      navigate('/gallery');
    } catch (error) {
      toast({
        title: 'Could not upload photos',
        description: error instanceof Error ? error.message : 'Upload failed',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
      setUploadProgress('');
    }
  };

  return (
    <div className="min-h-screen px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-light tracking-wide">Add Photos</h1>
          <p className="text-sm text-muted-foreground">Choose a stereo source method and upload into an album</p>
        </div>
        <Button asChild variant="secondary" className="gap-2">
          <Link to="/gallery">
            <ArrowLeft className="h-4 w-4" />
            Gallery
          </Link>
        </Button>
      </header>

      <form onSubmit={handleSubmit} className="mx-auto max-w-5xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Destination</CardTitle>
            <CardDescription>Choose an existing event and album. Create them in management first if needed.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Event</Label>
              <Select value={selectedEventId} onValueChange={setSelectedEventId} disabled={isLoadingData || isSubmitting}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose event" />
                </SelectTrigger>
                <SelectContent>
                  {galleryData.events.map((event) => (
                    <SelectItem key={event.id} value={event.id}>
                      {event.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Album</Label>
              <Select
                value={selectedAlbumId}
                onValueChange={setSelectedAlbumId}
                disabled={isLoadingData || isSubmitting || !selectedEventId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Choose album" />
                </SelectTrigger>
                <SelectContent>
                  {albumsForSelectedEvent.map((album) => (
                    <SelectItem key={album.id} value={album.id}>
                      {album.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {galleryData.events.length === 0 || galleryData.albums.length === 0 ? (
              <div className="rounded-md border border-border p-3 text-sm text-muted-foreground md:col-span-2">
                Uploads require an existing event and album.
                <Button asChild variant="link" className="h-auto px-2 py-0">
                  <Link to="/manage?reason=missing-destination">Open management</Link>
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Stereo Image Source</CardTitle>
            <CardDescription>Only controls for the selected method are shown.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-4">
              {[
                { value: 'single-folder', label: 'Folder', icon: Folder },
                { value: 'separate-folders', label: 'Left/Right Folders', icon: FolderOpen },
                { value: 'single-pair', label: 'Single Pair', icon: Images },
                { value: 'dropbox-urls', label: 'Dropbox URLs', icon: Cloud },
              ].map((method) => {
                const Icon = method.icon;
                const isActive = uploadMethod === method.value;

                return (
                  <button
                    key={method.value}
                    type="button"
                    onClick={() => handleMethodChange(method.value as UploadMethod)}
                    className={`flex items-center justify-center gap-2 rounded-md border px-3 py-3 text-sm transition-colors ${
                      isActive ? 'border-foreground bg-foreground text-background' : 'border-border bg-secondary hover:bg-accent'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {method.label}
                  </button>
                );
              })}
            </div>

            {uploadMethod === 'single-folder' && (
              <div className="space-y-2">
                <Label htmlFor="single-folder">Folder with L/R identifiers</Label>
                <Input
                  id="single-folder"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={handleSingleFolderSelect}
                  disabled={isSubmitting}
                  {...folderInputProps}
                />
              </div>
            )}

            {uploadMethod === 'separate-folders' && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="left-folder">Left folder</Label>
                  <Input
                    id="left-folder"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={handleLeftFolderSelect}
                    disabled={isSubmitting}
                    {...folderInputProps}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="right-folder">Right folder</Label>
                  <Input
                    id="right-folder"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={handleRightFolderSelect}
                    disabled={isSubmitting}
                    {...folderInputProps}
                  />
                </div>
              </div>
            )}

            {uploadMethod === 'single-pair' && (
              <div className="grid gap-4 md:grid-cols-2">
                <SinglePairImagePicker
                  id="left-photo"
                  label="Left photo"
                  file={singleLeftFile}
                  disabled={isSubmitting}
                  onChange={(file) => handleSinglePairChange('left', file)}
                />
                <SinglePairImagePicker
                  id="right-photo"
                  label="Right photo"
                  file={singleRightFile}
                  disabled={isSubmitting}
                  onChange={(file) => handleSinglePairChange('right', file)}
                />
              </div>
            )}

            {uploadMethod === 'dropbox-urls' && (
              <div className="space-y-2">
                <Label htmlFor="dropbox-urls">Dropbox image URLs</Label>
                <Textarea
                  id="dropbox-urls"
                  value={dropboxUrls}
                  onChange={(event) => handleDropboxUrlsChange(event.target.value)}
                  placeholder="Paste one Dropbox image URL per line. Names must include L/R markers."
                  disabled={isSubmitting}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="photo-name">Photo name prefix</Label>
              <Input
                id="photo-name"
                value={photoName}
                placeholder="Optional; matched pair names are used by default"
                onChange={(event) => setPhotoName(event.target.value)}
                disabled={isSubmitting}
              />
            </div>

            <div className="rounded-md bg-secondary p-3 text-sm text-muted-foreground">
              All methods are stored the same way: one generated side-by-side JPEG and one database photo row.
              Folder matching supports <span className="text-foreground">*_L / *_R</span>,{' '}
              <span className="text-foreground">*_left / *_right</span>, dash/dot/space variants, and left/right folders.
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Review</CardTitle>
            <CardDescription>Confirm detected pairs before uploading.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">Matched pairs ({matchedPairs.length})</p>
              {matchedPairs.length > 0 ? (
                <div className="max-h-64 space-y-2 overflow-auto">
                  {matchedPairs.map((pair) => (
                    <div key={pair.key} className="rounded bg-secondary p-2 text-xs">
                      <p className="font-medium text-foreground">{pair.name}</p>
                      <p className="truncate text-muted-foreground">L: {pair.left.label}</p>
                      <p className="truncate text-muted-foreground">R: {pair.right.label}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No stereo pairs detected yet.</p>
              )}
            </div>

            <div className="rounded-md border border-border p-3">
              <p className="mb-2 text-sm font-medium">Unmatched items ({unmatchedItems.length})</p>
              {unmatchedItems.length > 0 ? (
                <div className="max-h-64 space-y-1 overflow-auto">
                  {unmatchedItems.map((item) => (
                    <p key={item} className="truncate text-xs text-muted-foreground">
                      {item}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Nothing unmatched.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            type="submit"
            variant="secondary"
            className="gap-2"
              disabled={isUploadDisabledForAlbum ||
              isSubmitting ||
              matchedPairs.length === 0 ||
              !selectedEvent ||
              !selectedAlbum
            }
          >
            <Upload className="h-4 w-4" />
            {isSubmitting ? uploadProgress || 'Uploading...' : 'Upload Photos'}
          </Button>
            {isUploadDisabledForAlbum && (
              <p className="text-sm text-destructive">
                This album is linked to a Dropbox folder. Uploads are disabled.
              </p>
            )}
        </div>
      </form>
    </div>
  );
}
