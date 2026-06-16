import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import {
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
  createEventShareLink,
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
  const [albumTitle, setAlbumTitle] = useState('');
  const [albumDescription, setAlbumDescription] = useState('');
  const [albumSlug, setAlbumSlug] = useState('');
  const [albumCoverPhotoId, setAlbumCoverPhotoId] = useState<string | null>(null);
  const [sharePassword, setSharePassword] = useState('');
  const [createdShareUrl, setCreatedShareUrl] = useState('');
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
  const activeEventShareLink = useMemo(() => {
    if (!selectedEvent) return null;

    return (
      shareLinks.find((shareLink) => {
        const isExpired = shareLink.expires_at ? Date.parse(shareLink.expires_at) <= Date.now() : false;
        return shareLink.scope === 'event' && shareLink.event_id === selectedEvent.id && shareLink.is_active && !isExpired;
      }) ?? null
    );
  }, [selectedEvent, shareLinks]);
  const eventShareUrl = selectedEvent && profileSlug ? buildPublicUrl(profileSlug, selectedEvent.slug) : '';

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
      });
      setNewAlbumTitle('');
      setNewAlbumDescription('');
      setNewAlbumSlug('');
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

  const createShare = async () => {
    if (!selectedEvent || !profileSlug) return;
    setIsSaving(true);
    try {
      await createEventShareLink({
        eventId: selectedEvent.id,
        password: sharePassword,
      });
      const links = await fetchShareLinks();
      setShareLinks(links);
      setCreatedShareUrl(buildPublicUrl(profileSlug, selectedEvent.slug));
      setSharePassword('');
      toast({ title: sharePassword ? 'Protected event link created' : 'Public event link created' });
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

  const revokeShare = async () => {
    if (!activeEventShareLink) return;
    setIsSaving(true);
    try {
      await revokeShareLink(activeEventShareLink.id);
      const links = await fetchShareLinks();
      setShareLinks(links);
      setCreatedShareUrl('');
      toast({ title: 'Event share revoked' });
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

  const copyShareUrl = async () => {
    const url = createdShareUrl || eventShareUrl;
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast({ title: 'Share link copied' });
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
    <div className="min-h-screen px-4 py-6">
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
              <CardContent className="grid gap-4 md:grid-cols-[180px_1fr_1fr]">
                <button type="button" onClick={() => setCoverPicker('profile')} className="text-left">
                  <Label>Cover</Label>
                  <CoverPreview photo={profileCover} icon={<User className="h-6 w-6" />} className="mt-2 aspect-[4/3] w-full" />
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
                  <Button asChild variant="secondary" disabled={!profileSlug}>
                    <Link to={`/${profileSlug}`}>View Public Page</Link>
                  </Button>
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

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sortedEvents.map((eventRecord) => {
                const eventPhotos = photosByEvent[eventRecord.id] ?? [];
                const cover = getCoverPhoto(eventPhotos, eventRecord.cover_photo_id);
                const albums = galleryData.albums.filter((album) => album.event_id === eventRecord.id);

                return (
                  <Card key={eventRecord.id} className="overflow-hidden">
                    <div className="aspect-[3/2] bg-secondary">
                      <CoverPreview photo={cover} icon={<FolderOpen className="h-6 w-6" />} className="h-full w-full rounded-none" />
                    </div>
                    <CardContent className="space-y-3 p-4">
                      <div>
                        <h3 className="truncate text-lg font-medium">{eventRecord.title}</h3>
                        <p className="text-sm text-muted-foreground">{albums.length} {albums.length === 1 ? 'album' : 'albums'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500">
                          <Link to={`/manage/events/${eventRecord.id}`}>Manage Event</Link>
                        </Button>
                        <Button asChild variant="secondary" size="sm">
                          <Link to={`/${profileSlug}/${eventRecord.slug}`}>View</Link>
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setDeletingEvent(eventRecord)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FolderOpen className="h-5 w-5" />
                  Event Settings
                </CardTitle>
                <CardDescription>Albums are added from this event page only.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[180px_1fr_1fr]">
                <button type="button" onClick={() => setCoverPicker('event')} className="text-left">
                  <Label>Cover</Label>
                  <CoverPreview photo={eventCover} icon={<FolderOpen className="h-6 w-6" />} className="mt-2 aspect-[4/3] w-full" />
                </button>
                <div className="space-y-2">
                  <Label htmlFor="event-title">Name</Label>
                  <Input id="event-title" value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="event-slug">Public URL slug</Label>
                  <Input id="event-slug" value={eventSlug} onChange={(event) => setEventSlug(makeSlug(event.target.value))} />
                </div>
                <div className="space-y-2 md:col-span-2 md:col-start-2">
                  <Label htmlFor="event-description">Description</Label>
                  <Textarea id="event-description" value={eventDescription} onChange={(event) => setEventDescription(event.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2 md:col-span-2 md:col-start-2">
                  <Button className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={saveEvent} disabled={!eventTitle || !eventSlug || isSaving}>
                    Save Event
                  </Button>
                  <Button asChild variant="secondary">
                    <Link to={`/${profileSlug}/${selectedEvent.slug}`}>View Event</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Link2 className="h-5 w-5" />
                  Event Sharing
                </CardTitle>
                <CardDescription>Albums under this event inherit event access. Password is optional.</CardDescription>
              </CardHeader>
              <CardContent className={activeEventShareLink ? 'space-y-3' : 'grid gap-3 md:grid-cols-[1fr_auto]'}>
                {activeEventShareLink ? (
                  <>
                    <div className="space-y-2 rounded-md border bg-secondary/40 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Label>Active event share link</Label>
                        <span className="text-xs text-muted-foreground">
                          {activeEventShareLink.password_hash ? 'Password protected' : 'No password required'}
                        </span>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row">
                        <Input value={eventShareUrl} readOnly />
                        <Button className="gap-2" variant="secondary" onClick={copyShareUrl} disabled={!eventShareUrl}>
                          <Copy className="h-4 w-4" />
                          Copy
                        </Button>
                      </div>
                    </div>
                    <Button variant="destructive" className="gap-2" onClick={revokeShare} disabled={isSaving}>
                      <Trash2 className="h-4 w-4" />
                      Revoke Share
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="event-share-password">Visible password</Label>
                      <Input
                        id="event-share-password"
                        type="text"
                        value={sharePassword}
                        placeholder="Leave blank for no password"
                        onChange={(event) => setSharePassword(event.target.value)}
                      />
                    </div>
                    <Button className="self-end bg-emerald-600 text-white hover:bg-emerald-500" onClick={createShare} disabled={isSaving}>
                      Create Share Link
                    </Button>
                  </>
                )}
                {!activeEventShareLink && createdShareUrl && (
                  <Button className="self-end gap-2" variant="secondary" onClick={copyShareUrl}>
                    <Copy className="h-4 w-4" />
                    Copy
                  </Button>
                )}
                {!activeEventShareLink && createdShareUrl && <Input className="md:col-span-2" value={createdShareUrl} readOnly />}
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-light">Albums</h2>
              <Button onClick={() => setIsAlbumDialogOpen(true)} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-500">
                <Plus className="h-4 w-4" />
                Add Album
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {eventAlbums.map((album) => {
                const photos = photosByAlbum[album.id] ?? [];
                const cover = getCoverPhoto(photos, album.cover_photo_id);

                return (
                  <Card key={album.id} className="overflow-hidden">
                    <div className="aspect-[3/2] bg-secondary">
                      <CoverPreview photo={cover} icon={<Images className="h-6 w-6" />} className="h-full w-full rounded-none" />
                    </div>
                    <CardContent className="space-y-3 p-4">
                      <div>
                        <h3 className="truncate text-lg font-medium">{album.title}</h3>
                        <p className="text-sm text-muted-foreground">{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button asChild size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500">
                          <Link to={`/manage/events/${selectedEvent.id}/albums/${album.id}`}>Manage Album</Link>
                        </Button>
                        <Button asChild variant="secondary" size="sm">
                          <Link to={`/${profileSlug}/${selectedEvent.slug}/${album.slug}`}>View</Link>
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => setDeletingAlbum(album)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
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
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Images className="h-5 w-5" />
                  Album Settings
                </CardTitle>
                <CardDescription>Photos are uploaded from this album page only.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-[180px_1fr_1fr]">
                <button type="button" onClick={() => setCoverPicker('album')} className="text-left">
                  <Label>Cover</Label>
                  <CoverPreview photo={albumCover} icon={<Images className="h-6 w-6" />} className="mt-2 aspect-[4/3] w-full" />
                </button>
                <div className="space-y-2">
                  <Label htmlFor="album-title">Name</Label>
                  <Input id="album-title" value={albumTitle} onChange={(event) => setAlbumTitle(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="album-slug">Public URL slug</Label>
                  <Input id="album-slug" value={albumSlug} onChange={(event) => setAlbumSlug(makeSlug(event.target.value))} />
                </div>
                <div className="space-y-2 md:col-span-2 md:col-start-2">
                  <Label htmlFor="album-description">Description</Label>
                  <Textarea id="album-description" value={albumDescription} onChange={(event) => setAlbumDescription(event.target.value)} />
                </div>
                <div className="flex flex-wrap gap-2 md:col-span-2 md:col-start-2">
                  <Button className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={saveAlbum} disabled={!albumTitle || !albumSlug || isSaving}>
                    Save Album
                  </Button>
                  <Button asChild variant="secondary">
                    <Link to={`/${profileSlug}/${selectedAlbumEvent.slug}/${selectedAlbum.slug}`}>View Album</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Upload className="h-5 w-5" />
                  Add SBS Stereo Photos
                </CardTitle>
                <CardDescription>Select already-created side-by-side stereo image files for this album.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleUploadSbsPhotos} className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
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
              </CardContent>
            </Card>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {albumPhotos.map((photo) => (
                <Card key={photo.id} className="overflow-hidden">
                  <div className="aspect-[2/1] bg-secondary">
                    <StereoThumbnail photo={photo} />
                  </div>
                  <CardContent className="flex items-center justify-between gap-3 p-3">
                    <p className="truncate text-sm text-muted-foreground">{photo.alt || 'Untitled photo'}</p>
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
              Type <span className="font-medium text-foreground">{deleteTargetName}</span> to confirm.
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
