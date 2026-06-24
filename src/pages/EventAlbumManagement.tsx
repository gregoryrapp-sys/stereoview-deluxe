import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Cloud,
  AlertCircle,
  ArrowLeft,
  Copy,
  Edit,
  FolderOpen,
  ImagePlus,
  Images,
  Link2,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  createAlbum,
  createEvent,
  fetchDropboxPhotos,
  createShareLink,
  deleteAlbumWithPhotos,
  deleteEventWithPhotos,
  fetchGalleryData,
  fetchShareLinks,
  GalleryData,
  GalleryPhoto,
  makeSlug,
  revokeShareLink,
  updateAlbum,
  updateEvent,
  updateProfilePresentation,
  uploadSbsPhoto,
} from '@/services/galleryService';
import type { AlbumRecord, EventRecord, ShareLinkRecord } from '@/types/database';
import StereoThumbnail from '@/components/StereoThumbnail';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';

function getCoverPhoto(photos: GalleryPhoto[], coverPhotoId?: string | null) {
  return photos.find((photo) => photo.id === coverPhotoId) ?? photos[0] ?? null;
}

function CoverPreview({
  photo,
  icon,
  className,
}: {
  photo: GalleryPhoto | null;
  icon: React.ReactNode;
  className: string;
}) {
  return (
    <div className={`shrink-0 overflow-hidden rounded-md bg-secondary ${className}`}>
      {photo ? (
        <StereoThumbnail photo={photo} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">{icon}</div>
      )}
    </div>
  );
}

function CoverPickerDialog({
  title,
  open,
  photos,
  selectedPhotoId,
  onClose,
  onSelect,
}: {
  title: string;
  open: boolean;
  photos: GalleryPhoto[];
  selectedPhotoId: string | null;
  onClose: () => void;
  onSelect: (photoId: string | null) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Choose a photo visually. If no cover is selected, the first photo is used.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-3 overflow-auto sm:grid-cols-2 lg:grid-cols-3">
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`flex aspect-[2/1] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground ${
              selectedPhotoId === null ? 'ring-2 ring-ring' : ''
            }`}
          >
            Use first photo automatically
          </button>
          {photos.map((photo) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => onSelect(photo.id)}
              className={`group relative aspect-[2/1] overflow-hidden rounded-md bg-secondary ${
                selectedPhotoId === photo.id ? 'ring-2 ring-ring' : ''
              }`}
            >
              <StereoThumbnail photo={photo} />
              <span className="absolute inset-x-0 bottom-0 bg-background/80 px-2 py-1 text-left text-xs backdrop-blur-sm">
                {photo.alt || 'Untitled photo'}
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function buildPublicUrl(profileSlug: string, eventSlug?: string, albumSlug?: string) {
  const parts = [window.location.origin, profileSlug, eventSlug, albumSlug].filter(Boolean);
  return parts.join('/');
}

export default function EventAlbumManagement() {
  const { eventId, albumId } = useParams();
  const { isAuthenticated, isLoading: isAuthLoading, profile, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [galleryData, setGalleryData] = useState<GalleryData>({ events: [], albums: [], photos: [] });
  const [shareLinks, setShareLinks] = useState<ShareLinkRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEventDialogOpen, setIsEventDialogOpen] = useState(false);
  const [isAlbumDialogOpen, setIsAlbumDialogOpen] = useState(false);
  const [coverPicker, setCoverPicker] = useState<'profile' | 'event' | 'album' | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<EventRecord | null>(null);
  const [deletingAlbum, setDeletingAlbum] = useState<AlbumRecord | null>(null);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profileSlug, setProfileSlug] = useState('');
  const [profileCoverPhotoId, setProfileCoverPhotoId] = useState<string | null>(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDescription, setNewEventDescription] = useState('');
  const [newEventSlug, setNewEventSlug] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventSlug, setEventSlug] = useState('');
  const [eventCoverPhotoId, setEventCoverPhotoId] = useState<string | null>(null);
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [newAlbumDescription, setNewAlbumDescription] = useState('');
  const [newAlbumSlug, setNewAlbumSlug] = useState('');
  const [newAlbumSourceType, setNewAlbumSourceType] = useState<'upload' | 'dropbox'>('upload');
  const [newAlbumDropboxUrl, setNewAlbumDropboxUrl] = useState('');
  const [albumTitle, setAlbumTitle] = useState('');
  const [albumDescription, setAlbumDescription] = useState('');
  const [albumSlug, setAlbumSlug] = useState('');
  const [albumCoverPhotoId, setAlbumCoverPhotoId] = useState<string | null>(null);
  const [sharePasswords, setSharePasswords] = useState<Record<string, string>>({});
  const [createdShareUrls, setCreatedShareUrls] = useState<Record<string, string>>({});
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadNamePrefix, setUploadNamePrefix] = useState('');
  const [uploadProgress, setUploadProgress] = useState('');
  const shouldShowUploadRedirectNotice = searchParams.get('reason') === 'missing-destination';

  const loadData = useCallback(() => {
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      try {
        const [data, links] = await Promise.all([fetchGalleryData(), fetchShareLinks()]);
        if (!cancelled) {
          setGalleryData(data);
          setShareLinks(links);
        }
      } catch (error) {
        toast({
          title: 'Could not load gallery data',
          description: error instanceof Error ? error.message : 'Supabase data failed to load',
          variant: 'destructive',
        });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;
    return loadData();
  }, [isAuthenticated, loadData]);

  useEffect(() => {
    if (!profile) return;
    setProfileDisplayName(profile.display_name ?? '');
    setProfileSlug(profile.slug ?? '');
    setProfileCoverPhotoId(profile.cover_photo_id ?? null);
  }, [profile]);

  const sortedEvents = useMemo(
    () => [...galleryData.events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [galleryData.events],
  );

  const selectedEvent = useMemo(
    () => galleryData.events.find((event) => event.id === eventId) ?? null,
    [eventId, galleryData.events],
  );

  const eventAlbums = useMemo(
    () =>
      [...galleryData.albums]
        .filter((album) => album.event_id === eventId)
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [eventId, galleryData.albums],
  );

  const selectedAlbum = useMemo(
    () => galleryData.albums.find((album) => album.id === albumId) ?? null,
    [albumId, galleryData.albums],
  );

  const selectedAlbumEvent = useMemo(
    () => galleryData.events.find((event) => event.id === selectedAlbum?.event_id) ?? selectedEvent,
    [galleryData.events, selectedAlbum?.event_id, selectedEvent],
  );

  const photosByAlbum = useMemo(() => {
    return galleryData.photos.reduce<Record<string, GalleryPhoto[]>>((groups, photo) => {
      if (!photo.albumId) return groups;
      groups[photo.albumId] = [...(groups[photo.albumId] ?? []), photo];
      return groups;
    }, {});
  }, [galleryData.photos]);

  const photosByEvent = useMemo(() => {
    return galleryData.photos.reduce<Record<string, GalleryPhoto[]>>((groups, photo) => {
      if (!photo.eventId) return groups;
      groups[photo.eventId] = [...(groups[photo.eventId] ?? []), photo];
      return groups;
    }, {});
  }, [galleryData.photos]);

  const albumPhotos = selectedAlbum ? photosByAlbum[selectedAlbum.id] ?? [] : [];
  const profileCover = getCoverPhoto(galleryData.photos, profileCoverPhotoId);
  const eventCover = selectedEvent ? getCoverPhoto(photosByEvent[selectedEvent.id] ?? [], eventCoverPhotoId) : null;
  const albumCover = selectedAlbum ? getCoverPhoto(albumPhotos, albumCoverPhotoId) : null;
  const findActiveShareLink = useCallback(
    (matchesScope: (shareLink: ShareLinkRecord) => boolean) =>
      shareLinks.find((shareLink) => {
        const isExpired = shareLink.expires_at ? Date.parse(shareLink.expires_at) <= Date.now() : false;
        return shareLink.is_active && !isExpired && matchesScope(shareLink);
      }) ?? null,
    [shareLinks],
  );
  const activeProfileShareLink = useMemo(() => {
    if (!profile) return null;

    return findActiveShareLink((shareLink) => shareLink.scope === 'profile' && shareLink.profile_id === profile.id);
  }, [findActiveShareLink, profile]);
  const activeEventShareLink = useMemo(() => {
    if (!selectedEvent) return null;

    return findActiveShareLink((shareLink) => shareLink.scope === 'event' && shareLink.event_id === selectedEvent.id);
  }, [findActiveShareLink, selectedEvent]);
  const profileShareUrl = profileSlug ? buildPublicUrl(profileSlug) : '';
  const eventShareUrl = selectedEvent && profileSlug ? buildPublicUrl(profileSlug, selectedEvent.slug) : '';
  const albumShareUrl =
    selectedAlbum && selectedAlbumEvent && profileSlug ? buildPublicUrl(profileSlug, selectedAlbumEvent.slug, selectedAlbum.slug) : '';

  useEffect(() => {
    if (!selectedEvent) return;
    setEventTitle(selectedEvent.title);
    setEventDescription(selectedEvent.description ?? '');
    setEventSlug(selectedEvent.slug);
    setEventCoverPhotoId(selectedEvent.cover_photo_id);
  }, [selectedEvent]);

  useEffect(() => {
    if (!selectedAlbum) return;
    setAlbumTitle(selectedAlbum.title);
    setAlbumDescription(selectedAlbum.description ?? '');
    setAlbumSlug(selectedAlbum.slug);
    setAlbumCoverPhotoId(selectedAlbum.cover_photo_id);
  }, [selectedAlbum]);

  if (isAuthLoading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const saveProfile = async () => {
    if (!profile) return;
    setIsSaving(true);
    try {
      await updateProfilePresentation({
        profileId: profile.id,
        displayName: profileDisplayName,
        slug: profileSlug,
        coverPhotoId: profileCoverPhotoId,
      });
      toast({ title: 'Photographer page saved' });
    } catch (error) {
      toast({
        title: 'Could not save photographer page',
        description: error instanceof Error ? error.message : 'Save failed',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateEvent = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setIsSaving(true);
    try {
      await createEvent({
        ownerId: user.id,
        title: newEventTitle,
        description: newEventDescription,
        slug: newEventSlug || undefined,
      });
      setNewEventTitle('');
      setNewEventDescription('');
      setNewEventSlug('');
      setIsEventDialogOpen(false);
      toast({ title: 'Event created' });
      loadData();
    } catch (error) {
      toast({
        title: 'Could not create event',
        description: error instanceof Error ? error.message : 'Create failed',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const saveEvent = async () => {
    if (!selectedEvent) return;
    setIsSaving(true);
    try {
      await updateEvent({
        eventId: selectedEvent.id,
        title: eventTitle,
        description: eventDescription,
        slug: eventSlug,
        coverPhotoId: eventCoverPhotoId,
      });
      toast({ title: 'Event saved' });
      loadData();
    } catch (error) {
      toast({
        title: 'Could not save event',
        description: error instanceof Error ? error.message : 'Save failed',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateAlbum = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedEvent) return;
    setIsSaving(true);
    try {
      await createAlbum({
        eventId: selectedEvent.id,
        title: newAlbumTitle,
        description: newAlbumDescription,
        slug: newAlbumSlug || undefined,
        source_type: newAlbumSourceType,
        dropbox_folder_url: newAlbumSourceType === 'dropbox' ? newAlbumDropboxUrl : undefined,
      });
      setNewAlbumTitle('');
      setNewAlbumDescription('');
      setNewAlbumSlug('');
      setNewAlbumSourceType('upload');
      setNewAlbumDropboxUrl('');
      setIsAlbumDialogOpen(false);
      toast({ title: 'Album created' });
      loadData();
    } catch (error) {
      toast({
        title: 'Could not create album',
        description: error instanceof Error ? error.message : 'Create failed',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const saveAlbum = async () => {
    if (!selectedAlbum) return;
    setIsSaving(true);
    try {
      await updateAlbum({
        albumId: selectedAlbum.id,
        title: albumTitle,
        description: albumDescription,
        slug: albumSlug,
        // For now, we are not allowing to change the source type of an existing album
        // to avoid complexity with existing photos. This could be a future enhancement.
        coverPhotoId: albumCoverPhotoId,
      });
      toast({ title: 'Album saved' });
      loadData();
    } catch (error) {
      toast({
        title: 'Could not save album',
        description: error instanceof Error ? error.message : 'Save failed',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const createShare = async ({
    key,
    profileId,
    eventId,
    url,
  }: {
    key: string;
    profileId?: string | null;
    eventId?: string | null;
    url: string;
  }) => {
    if (!url) return;
    setIsSaving(true);
    try {
      const scope = eventId ? 'event' : 'profile';
      const password = sharePasswords[key] ?? '';
      await createShareLink({
        scope,
        profileId,
        eventId,
        password,
      });
      const links = await fetchShareLinks();
      setShareLinks(links);
      setCreatedShareUrls((current) => ({ ...current, [key]: url }));
      setSharePasswords((current) => ({ ...current, [key]: '' }));
      toast({ title: password ? 'Protected share link created' : 'Public share link created' });
    } catch (error) {
      toast({
        title: 'Could not create share link',
        description: error instanceof Error ? error.message : 'Share failed',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const revokeShare = async (shareLink: ShareLinkRecord | null, key: string) => {
    if (!shareLink) return;
    setIsSaving(true);
    try {
      await revokeShareLink(shareLink.id);
      const links = await fetchShareLinks();
      setShareLinks(links);
      setCreatedShareUrls((current) => ({ ...current, [key]: '' }));
      toast({ title: 'Share link revoked' });
    } catch (error) {
      toast({
        title: 'Could not revoke share link',
        description: error instanceof Error ? error.message : 'Revoke failed',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const copyShareUrl = async (url: string) => {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast({ title: 'Share link copied' });
  };

  const renderSharePanel = ({
    title,
    keyName,
    activeShareLink,
    url,
    profileId,
    eventId,
    compact = false,
  }: {
    title: string;
    keyName: string;
    activeShareLink: ShareLinkRecord | null;
    url: string;
    profileId?: string | null;
    eventId?: string | null;
    compact?: boolean;
  }) => {
    const createdShareUrl = createdShareUrls[keyName] ?? '';
    const copyUrl = createdShareUrl || url;

    return (
      <div className={compact ? 'space-y-2' : 'space-y-3 border-t pt-3'}>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Link2 className="h-4 w-4" />
          {title}
        </div>
        <div className={activeShareLink ? 'space-y-3' : `grid gap-3 ${compact ? '' : 'md:grid-cols-[1fr_auto]'}`}>
          {activeShareLink ? (
            <>
              <div className="space-y-2 rounded-md border bg-secondary/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label>Active share link</Label>
                  <span className="text-xs text-muted-foreground">
                    {activeShareLink.password_hash ? 'Password protected' : 'No password required'}
                  </span>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <p className="min-w-0 flex-1 select-all break-all rounded-md bg-background px-3 py-2 text-sm text-muted-foreground">
                    {url}
                  </p>
                  <Button className="gap-2" variant="secondary" onClick={() => copyShareUrl(url)} disabled={!url}>
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                  <Button variant="destructive" className="gap-2" onClick={() => revokeShare(activeShareLink, keyName)} disabled={isSaving}>
                    <Trash2 className="h-4 w-4" />
                    Revoke
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor={`${keyName}-share-password`}>Visible password</Label>
                <Input
                  id={`${keyName}-share-password`}
                  type="text"
                  value={sharePasswords[keyName] ?? ''}
                  placeholder="Leave blank for no password"
                  onChange={(event) => setSharePasswords((current) => ({ ...current, [keyName]: event.target.value }))}
                />
              </div>
              <Button
                className="self-end bg-emerald-600 text-white hover:bg-emerald-500"
                onClick={() => createShare({ key: keyName, profileId, eventId, url })}
                disabled={isSaving || !url}
              >
                Create Share Link
              </Button>
            </>
          )}
          {!activeShareLink && createdShareUrl && (
            <Button className="self-end gap-2" variant="secondary" onClick={() => copyShareUrl(copyUrl)}>
              <Copy className="h-4 w-4" />
              Copy
            </Button>
          )}
          {!activeShareLink && createdShareUrl && <Input className="md:col-span-2" value={createdShareUrl} readOnly />}
        </div>
      </div>
    );
  };

  const renderSharedUrlField = (url: string, className = '') => {
    if (!url) return null;

    return (
      <div className={`flex min-w-0 items-center gap-2 ${className}`}>
        <p className="min-w-0 flex-1 select-all truncate rounded-md bg-secondary px-2.5 py-1.5 text-xs text-muted-foreground">
          {url}
        </p>
        <Button size="sm" variant="secondary" className="h-8 shrink-0 gap-1 px-2" onClick={() => copyShareUrl(url)}>
          <Copy className="h-3.5 w-3.5" />
          Copy
        </Button>
      </div>
    );
  };

  const handleUploadSbsPhotos = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedAlbum || !selectedAlbumEvent || uploadFiles.length === 0) return;

    setIsSaving(true);
    setUploadProgress('');
    try {
      for (const [index, file] of uploadFiles.entries()) {
        setUploadProgress(`Uploading ${index + 1} of ${uploadFiles.length}`);
        await uploadSbsPhoto({
          albumId: selectedAlbum.id,
          eventId: selectedAlbumEvent.id,
          ownerId: selectedAlbumEvent.owner_id,
          file,
          alt: uploadNamePrefix ? `${uploadNamePrefix} ${index + 1}` : file.name.replace(/\.[^.]+$/, ''),
        });
      }
      setUploadFiles([]);
      setUploadNamePrefix('');
      toast({ title: uploadFiles.length === 1 ? 'Photo uploaded' : `${uploadFiles.length} photos uploaded` });
      loadData();
    } catch (error) {
      toast({
        title: 'Could not upload photos',
        description: error instanceof Error ? error.message : 'Upload failed',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
      setUploadProgress('');
    }
  };

  const deleteTarget = deletingEvent ?? deletingAlbum;
  const deleteTargetName = deleteTarget?.title ?? '';

  const confirmDelete = async () => {
    if (!deleteTarget || deleteConfirmationText !== deleteTargetName) return;
    setIsSaving(true);
    try {
      if (deletingEvent) {
        await deleteEventWithPhotos(deletingEvent.id);
        toast({ title: 'Event deleted' });
      } else if (deletingAlbum) {
        await deleteAlbumWithPhotos(deletingAlbum.id);
        toast({ title: 'Album deleted' });
      }
      setDeletingEvent(null);
      setDeletingAlbum(null);
      setDeleteConfirmationText('');
      loadData();
    } catch (error) {
      toast({
        title: 'Could not delete',
        description: error instanceof Error ? error.message : 'Delete failed',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const renderHeader = (title: string, subtitle: string, backTo?: string) => (
    <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-light tracking-wide">{title}</h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {backTo && (
          <Button asChild variant="secondary" className="gap-2">
            <Link to={backTo}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Link>
          </Button>
        )}
        <Button asChild variant="secondary" className="gap-2">
          <Link to="/gallery">
            <Images className="h-4 w-4" />
            Private Gallery
          </Link>
        </Button>
        <Button asChild variant="secondary" className="gap-2">
          <Link to="/photographers">
            <User className="h-4 w-4" />
            Photographers
          </Link>
        </Button>
        <Button variant="secondary" onClick={loadData} disabled={isLoading || isSaving} className="gap-2">
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </div>
    </header>
  );

  if (eventId && !selectedEvent && !albumId) {
    return <div className="p-6 text-muted-foreground">Event not found.</div>;
  }

  if (albumId && (!selectedAlbum || !selectedAlbumEvent)) {
    return <div className="p-6 text-muted-foreground">Album not found.</div>;
  }

  const isProfileLevel = !eventId && !albumId;
  const isEventLevel = !!eventId && !albumId;
  const isAlbumLevel = !!albumId;

  return (
    <div className="min-h-screen px-3 py-4 sm:px-4 sm:py-6">
      {isProfileLevel && renderHeader('Photographer Page', 'Add events and configure your public photographer page')}
      {isEventLevel && selectedEvent && renderHeader(selectedEvent.title, 'Add albums and configure this event', '/manage')}
      {isAlbumLevel &&
        selectedAlbum &&
        selectedAlbumEvent &&
        renderHeader(selectedAlbum.title, 'Upload SBS stereo photos and configure this album', `/manage/events/${selectedAlbumEvent.id}`)}

      {shouldShowUploadRedirectNotice && (
        <div className="mb-5 flex items-start gap-2 rounded-md border border-primary/40 bg-secondary p-3 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
          <span>Create an event and album before uploading photos.</span>
        </div>
      )}

      <main className="mx-auto max-w-6xl space-y-4">
        {isProfileLevel && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <User className="h-5 w-5" />
                  Public Photographer Page
                </CardTitle>
                <CardDescription>Visitors see this page at /{profileSlug || profile?.slug || 'name'}.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 md:grid-cols-[104px_1fr_1fr]">
                <button type="button" onClick={() => setCoverPicker('profile')} className="text-left">
                  <Label>Cover</Label>
                  <CoverPreview photo={profileCover} icon={<User className="h-6 w-6" />} className="mt-1 aspect-[4/3] w-full" />
                </button>
                <div className="space-y-2">
                  <Label htmlFor="profile-display-name">Display name</Label>
                  <Input id="profile-display-name" value={profileDisplayName} onChange={(event) => setProfileDisplayName(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profile-slug">Public URL slug</Label>
                  <Input id="profile-slug" value={profileSlug} onChange={(event) => setProfileSlug(makeSlug(event.target.value))} />
                </div>
                <div className="flex flex-wrap gap-2 md:col-span-2 md:col-start-2">
                  <Button className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={saveProfile} disabled={!profileSlug || isSaving}>
                    Save Photographer Page
                  </Button>
                </div>
                {activeProfileShareLink && renderSharedUrlField(profileShareUrl, 'md:col-span-2 md:col-start-2')}
                <div className="md:col-span-3">
                  {renderSharePanel({
                    title: 'Photographer Page Sharing',
                    keyName: 'profile',
                    activeShareLink: activeProfileShareLink,
                    url: profileShareUrl,
                    profileId: profile?.id,
                  })}
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-light">Events</h2>
              <Button onClick={() => setIsEventDialogOpen(true)} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500">
                <Plus className="h-4 w-4" />
                Add Event
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
              {sortedEvents.map((eventRecord) => {
                const eventPhotos = photosByEvent[eventRecord.id] ?? [];
                const cover = getCoverPhoto(eventPhotos, eventRecord.cover_photo_id);
                const albums = galleryData.albums.filter((album) => album.event_id === eventRecord.id);

                return (
                  <Card key={eventRecord.id} className="overflow-hidden">
                    <div className="aspect-[3/2] bg-secondary">
                      <CoverPreview photo={cover} icon={<FolderOpen className="h-6 w-6" />} className="h-full w-full rounded-none" />
                    </div>
                    <CardContent className="space-y-2 p-3">
                      <div>
                        <h3 className="truncate text-sm font-medium">{eventRecord.title}</h3>
                        <p className="text-xs text-muted-foreground">{albums.length} {albums.length === 1 ? 'album' : 'albums'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500">
                          <Link to={`/manage/events/${eventRecord.id}`}>Manage Event</Link>
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setDeletingEvent(eventRecord)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {(findActiveShareLink((shareLink) => shareLink.scope === 'event' && shareLink.event_id === eventRecord.id) ||
                        activeProfileShareLink) &&
                        renderSharedUrlField(buildPublicUrl(profileSlug, eventRecord.slug))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {isEventLevel && selectedEvent && (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FolderOpen className="h-5 w-5" />
                  Event Settings
                </CardTitle>
                <CardDescription>Albums are added from this event page only.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 md:grid-cols-[104px_1fr_1fr]">
                <button type="button" onClick={() => setCoverPicker('event')} className="text-left">
                  <Label>Cover</Label>
                  <CoverPreview photo={eventCover} icon={<FolderOpen className="h-6 w-6" />} className="mt-1 aspect-[4/3] w-full" />
                </button>
                <div className="space-y-2">
                  <Label htmlFor="event-title">Name</Label>
                  <Input id="event-title" value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-slug">Public URL slug</Label>
                  <Input id="event-slug" value={eventSlug} onChange={(event) => setEventSlug(makeSlug(event.target.value))} />
                </div>
                <div className="space-y-2 md:col-start-2">
                  <Label htmlFor="event-description">Description</Label>
                  <Textarea id="event-description" value={eventDescription} onChange={(event) => setEventDescription(event.target.value)} />
                </div>
                <div>
                  {renderSharePanel({
                    title: 'Event Sharing',
                    keyName: `event-${selectedEvent.id}`,
                    activeShareLink: activeEventShareLink,
                    url: eventShareUrl,
                    eventId: selectedEvent.id,
                    compact: true,
                  })}
                </div>
                <div className="flex flex-wrap gap-2 md:col-span-2 md:col-start-2">
                  <Button className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={saveEvent} disabled={!eventTitle || !eventSlug || isSaving}>
                    Save Event
                  </Button>
                </div>
                {(activeEventShareLink || activeProfileShareLink) && renderSharedUrlField(eventShareUrl, 'md:col-span-2 md:col-start-2')}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-light">Albums</h2>
              <Button onClick={() => setIsAlbumDialogOpen(true)} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500">
                <Plus className="h-4 w-4" />
                Add Album
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-5">
              {eventAlbums.map((album) => {
                const photos = photosByAlbum[album.id] ?? [];
                const cover = getCoverPhoto(photos, album.cover_photo_id);

                return (
                  <Card key={album.id} className="overflow-hidden">
                    <div className="aspect-[3/2] bg-secondary">
                      <CoverPreview photo={cover} icon={<Images className="h-6 w-6" />} className="h-full w-full rounded-none" />
                    </div>
                    <CardContent className="space-y-2 p-3">
                      <div>
                        <h3 className="truncate text-sm font-medium">{album.title}</h3>
                        <p className="text-xs text-muted-foreground">{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500">
                          <Link to={`/manage/events/${selectedEvent.id}/albums/${album.id}`}>Manage Album</Link>
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setDeletingAlbum(album)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      {(activeEventShareLink || activeProfileShareLink) &&
                        renderSharedUrlField(buildPublicUrl(profileSlug, selectedEvent.slug, album.slug))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {isAlbumLevel && selectedAlbum && selectedAlbumEvent && (
          <>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Images className="h-5 w-5" />
                  Album Settings
                </CardTitle>
                <CardDescription>Photos are uploaded from this album page only.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 md:grid-cols-[104px_1fr_1fr]">
                <button type="button" onClick={() => setCoverPicker('album')} className="text-left">
                  <Label>Cover</Label>
                  <CoverPreview photo={albumCover} icon={<Images className="h-6 w-6" />} className="mt-1 aspect-[4/3] w-full" />
                </button>
                <div className="space-y-2">
                  <Label htmlFor="album-title">Name</Label>
                  <Input id="album-title" value={albumTitle} onChange={(event) => setAlbumTitle(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="album-slug">Public URL slug</Label>
                  <Input id="album-slug" value={albumSlug} onChange={(event) => setAlbumSlug(makeSlug(event.target.value))} />
                </div>
                <div className="space-y-2 md:col-start-2">
                  <Label htmlFor="album-description">Description</Label>
                  <Textarea id="album-description" value={albumDescription} onChange={(event) => setAlbumDescription(event.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2 md:col-span-2 md:col-start-2">
                  <Button className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={saveAlbum} disabled={!albumTitle || !albumSlug || isSaving}>
                    Save Album
                  </Button>
                </div>
                {selectedAlbum.source_type === 'dropbox' && (
                  <div className="space-y-3 border-t pt-3 md:col-span-3">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Cloud className="h-4 w-4" />
                        Dropbox Sync
                      </div>
                      <p className="text-xs text-muted-foreground">Manually sync with the linked Dropbox folder to check for new photos.</p>
                    </div>
                    <Button
                      onClick={async () => {
                        if (!selectedAlbum.dropbox_folder_url) return;
                        setIsSaving(true);
                        try {
                          const files = await fetchDropboxPhotos(selectedAlbum.dropbox_folder_url);
                          // The Edge Function already filters for valid image types.
                          toast({ title: 'Sync complete', description: `Found ${files.length} image files.` });
                        } catch (error) {
                          toast({ title: 'Sync failed', description: error instanceof Error ? error.message : 'Could not fetch from Dropbox.', variant: 'destructive' });
                        } finally {
                          setIsSaving(false);
                        }
                      }}
                      disabled={isSaving}
                    >
                      <RefreshCw className="mr-2 h-4 w-4" /> Sync with Dropbox
                    </Button>
                  </div>
                )}
                {(activeEventShareLink || activeProfileShareLink) && renderSharedUrlField(albumShareUrl, 'md:col-span-2 md:col-start-2')}
                <div className="space-y-3 border-t pt-3 md:col-span-3">
                  <div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Upload className="h-4 w-4" />
                      Upload SBS Stereo Photos
                    </div>
                    <p className="text-xs text-muted-foreground">Select already-created side-by-side stereo image files for this album.</p>
                  </div>
                  <form onSubmit={handleUploadSbsPhotos} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                    <div className="space-y-2">
                      <Label htmlFor="sbs-files">SBS image files</Label>
                      <Input
                        id="sbs-files"
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        multiple
                        onChange={(event) => setUploadFiles(Array.from(event.target.files ?? []))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="upload-prefix">Name prefix</Label>
                      <Input
                        id="upload-prefix"
                        value={uploadNamePrefix}
                        placeholder="Optional"
                        onChange={(event) => setUploadNamePrefix(event.target.value)}
                      />
                    </div>
                    <Button type="submit" className="self-end gap-2 bg-emerald-600 text-white hover:bg-emerald-500" disabled={uploadFiles.length === 0 || isSaving}>
                      <ImagePlus className="h-4 w-4" />
                      {isSaving ? uploadProgress || 'Uploading...' : 'Upload'}
                    </Button>
                  </form>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {albumPhotos.map((photo) => (
                <Card key={photo.id} className="overflow-hidden">
                  <div className="aspect-[2/1] bg-secondary">
                    <StereoThumbnail photo={photo} />
                  </div>
                  <CardContent className="flex items-center justify-between gap-2 p-2">
                    <p className="truncate text-xs text-muted-foreground">{photo.alt || 'Untitled photo'}</p>
                    <Button className="bg-emerald-600 text-white hover:bg-emerald-500" size="sm" onClick={() => setAlbumCoverPhotoId(photo.id)}>
                      Use as cover
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </main>

      <CoverPickerDialog
        title="Choose photographer cover"
        open={coverPicker === 'profile'}
        photos={galleryData.photos}
        selectedPhotoId={profileCoverPhotoId}
        onClose={() => setCoverPicker(null)}
        onSelect={(photoId) => {
          setProfileCoverPhotoId(photoId);
          setCoverPicker(null);
        }}
      />
      <CoverPickerDialog
        title="Choose event cover"
        open={coverPicker === 'event'}
        photos={selectedEvent ? photosByEvent[selectedEvent.id] ?? [] : []}
        selectedPhotoId={eventCoverPhotoId}
        onClose={() => setCoverPicker(null)}
        onSelect={(photoId) => {
          setEventCoverPhotoId(photoId);
          setCoverPicker(null);
        }}
      />
      <CoverPickerDialog
        title="Choose album cover"
        open={coverPicker === 'album'}
        photos={albumPhotos}
        selectedPhotoId={albumCoverPhotoId}
        onClose={() => setCoverPicker(null)}
        onSelect={(photoId) => {
          setAlbumCoverPhotoId(photoId);
          setCoverPicker(null);
        }}
      />

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingEvent(null);
            setDeletingAlbum(null);
            setDeleteConfirmationText('');
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deletingEvent ? 'event' : 'album'}</DialogTitle>
            <DialogDescription>
              This will delete the entire {deletingEvent ? 'event, including albums and photos inside it.' : 'album and its photos.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
            Type <span className="font-medium text-foreground break-all">{deleteTargetName}</span> to confirm.
            </p>
            <Input value={deleteConfirmationText} onChange={(event) => setDeleteConfirmationText(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="destructive" disabled={deleteConfirmationText !== deleteTargetName || isSaving} onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEventDialogOpen} onOpenChange={setIsEventDialogOpen}>
        <DialogContent>
          <form onSubmit={handleCreateEvent} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add Event</DialogTitle>
              <DialogDescription>Create a new event on your photographer page.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="new-event-title">Name</Label>
              <Input
                id="new-event-title"
                value={newEventTitle}
                onChange={(event) => {
                  setNewEventTitle(event.target.value);
                  if (!newEventSlug) setNewEventSlug(makeSlug(event.target.value));
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-event-slug">Public URL slug</Label>
              <Input id="new-event-slug" value={newEventSlug} onChange={(event) => setNewEventSlug(makeSlug(event.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-event-description">Description</Label>
              <Textarea id="new-event-description" value={newEventDescription} onChange={(event) => setNewEventDescription(event.target.value)} />
            </div>
            <DialogFooter>
              <Button type="submit" className="bg-emerald-600 text-white hover:bg-emerald-500" disabled={!newEventTitle || isSaving}>
                Create Event
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isAlbumDialogOpen} onOpenChange={setIsAlbumDialogOpen}>
        <DialogContent>
          <form onSubmit={handleCreateAlbum} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add Album</DialogTitle>
              <DialogDescription>Create an album inside this event.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="new-album-title">Name</Label>
              <Input
                id="new-album-title"
                value={newAlbumTitle}
                onChange={(event) => {
                  setNewAlbumTitle(event.target.value);
                  if (!newAlbumSlug) setNewAlbumSlug(makeSlug(event.target.value));
                }}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-album-slug">Public URL slug</Label>
              <Input id="new-album-slug" value={newAlbumSlug} onChange={(event) => setNewAlbumSlug(makeSlug(event.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-album-description">Description</Label>
              <Textarea id="new-album-description" value={newAlbumDescription} onChange={(event) => setNewAlbumDescription(event.target.value)} />
            </div>
            <div className="space-y-3 rounded-md border p-3">
              <Label>Photo Source</Label>
              <RadioGroup value={newAlbumSourceType} onValueChange={(value) => setNewAlbumSourceType(value as 'upload' | 'dropbox')}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="upload" id="source-upload" />
                  <Label htmlFor="source-upload">Direct Uploads</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="dropbox" id="source-dropbox" />
                  <Label htmlFor="source-dropbox">Dropbox Folder</Label>
                </div>
              </RadioGroup>
              {newAlbumSourceType === 'dropbox' && (
                <div className="space-y-2 pl-2 pt-2">
                  <Label htmlFor="new-album-dropbox-url">Dropbox Folder URL</Label>
                  <Input
                    id="new-album-dropbox-url"
                    value={newAlbumDropboxUrl}
                    onChange={(e) => setNewAlbumDropboxUrl(e.target.value)}
                    placeholder="Paste a public Dropbox folder link"
                  />
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" className="bg-emerald-600 text-white hover:bg-emerald-500" disabled={!newAlbumTitle || isSaving}>
                Create Album
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
