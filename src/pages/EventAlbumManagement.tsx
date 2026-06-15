import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Copy, Edit, FolderOpen, Images, Link2, Plus, RefreshCw, Trash2, User } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  createAlbum,
  createEvent,
  createShareLink,
  deleteAlbumWithPhotos,
  deleteEventWithPhotos,
  fetchGalleryData,
  GalleryData,
  GalleryPhoto,
  makeSlug,
  updateAlbum,
  updateEvent,
  updateProfilePresentation,
} from '@/services/galleryService';
import type { AlbumRecord, EventRecord, ShareScope } from '@/types/database';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';

type ShareTarget =
  | { scope: 'profile' }
  | { scope: 'event'; eventRecord: EventRecord }
  | { scope: 'album'; eventRecord: EventRecord; album: AlbumRecord };

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
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
          {icon}
        </div>
      )}
    </div>
  );
}

interface EventAlbumElementProps {
  eventRecord: EventRecord;
  albums: AlbumRecord[];
  photoCountsByAlbum: Record<string, number>;
  eventCover: GalleryPhoto | null;
  albumCoversByAlbum: Record<string, GalleryPhoto | null>;
  profileSlug: string;
  isSaving: boolean;
  onOpenDeleteEvent: (eventRecord: EventRecord) => void;
  onOpenDeleteAlbum: (album: AlbumRecord) => void;
  onOpenAddAlbum: (eventRecord: EventRecord) => void;
  onOpenEditEvent: (eventRecord: EventRecord) => void;
  onOpenEditAlbum: (album: AlbumRecord) => void;
  onOpenShare: (target: ShareTarget) => void;
}

function EventAlbumElement({
  eventRecord,
  albums,
  photoCountsByAlbum,
  eventCover,
  albumCoversByAlbum,
  profileSlug,
  isSaving,
  onOpenDeleteEvent,
  onOpenDeleteAlbum,
  onOpenAddAlbum,
  onOpenEditEvent,
  onOpenEditAlbum,
  onOpenShare,
}: EventAlbumElementProps) {
  return (
    <section className="rounded-md border border-border bg-card">
      <div className="space-y-4 border-b border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-3">
            <CoverPreview
              photo={eventCover}
              icon={<FolderOpen className="h-5 w-5" />}
              className="h-20 w-28"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-muted-foreground" />
                <h2 className="truncate text-xl font-light">{eventRecord.title || 'Untitled event'}</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {albums.length} {albums.length === 1 ? 'album' : 'albums'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" className="gap-2" onClick={() => onOpenAddAlbum(eventRecord)}>
              <Plus className="h-4 w-4" />
              Add Album
            </Button>
            <Button size="sm" className="gap-2" onClick={() => onOpenEditEvent(eventRecord)} disabled={isSaving}>
              <Edit className="h-4 w-4" />
              Edit
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="gap-2"
              onClick={() => onOpenShare({ scope: 'event', eventRecord })}
              disabled={isSaving}
            >
              <Link2 className="h-4 w-4" />
              Share
            </Button>
            <Button variant="destructive" size="sm" className="gap-2" onClick={() => onOpenDeleteEvent(eventRecord)} disabled={isSaving}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {eventRecord.description || 'No description'}
        </p>
        <p className="text-xs text-muted-foreground">/{profileSlug}/{eventRecord.slug}</p>
      </div>

      <div className="space-y-3 p-4">
        {albums.length > 0 ? (
          albums.map((album) => {
            const photoCount = photoCountsByAlbum[album.id] ?? 0;

            return (
              <div key={album.id} className="rounded-md border border-border bg-secondary/40 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 gap-3">
                    <CoverPreview
                      photo={albumCoversByAlbum[album.id] ?? null}
                      icon={<Images className="h-4 w-4" />}
                      className="h-16 w-24"
                    />
                    <div className="min-w-0">
                      <h3 className="truncate text-base font-medium">{album.title || 'Untitled album'}</h3>
                      <p className="mt-1 text-sm text-muted-foreground">{album.description || 'No description'}</p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="gap-2" onClick={() => onOpenEditAlbum(album)} disabled={isSaving}>
                      <Edit className="h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-2"
                      onClick={() => onOpenShare({ scope: 'album', eventRecord, album })}
                      disabled={isSaving}
                    >
                      <Link2 className="h-4 w-4" />
                      Share
                    </Button>
                    <Button variant="destructive" size="sm" className="gap-2" onClick={() => onOpenDeleteAlbum(album)} disabled={isSaving}>
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="rounded-md border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">No albums in this event yet.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function CoverPhotoSelect({
  label,
  photos,
  value,
  onChange,
}: {
  label: string;
  photos: GalleryPhoto[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder="Choose cover photo" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No cover selected</SelectItem>
          {photos.map((photo) => (
            <SelectItem key={photo.id} value={photo.id}>
              {photo.alt || photo.id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function EventAlbumManagement() {
  const { isAuthenticated, isLoading: isAuthLoading, profile, user } = useAuth();
  const [searchParams] = useSearchParams();
  const [galleryData, setGalleryData] = useState<GalleryData>({ events: [], albums: [], photos: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEventDialogOpen, setIsEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<EventRecord | null>(null);
  const [editingAlbum, setEditingAlbum] = useState<AlbumRecord | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<EventRecord | null>(null);
  const [deletingAlbum, setDeletingAlbum] = useState<AlbumRecord | null>(null);
  const [albumDialogEvent, setAlbumDialogEvent] = useState<EventRecord | null>(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDescription, setNewEventDescription] = useState('');
  const [newEventSlug, setNewEventSlug] = useState('');
  const [editEventTitle, setEditEventTitle] = useState('');
  const [editEventDescription, setEditEventDescription] = useState('');
  const [editEventSlug, setEditEventSlug] = useState('');
  const [editEventCoverPhotoId, setEditEventCoverPhotoId] = useState('none');
  const [editAlbumTitle, setEditAlbumTitle] = useState('');
  const [editAlbumDescription, setEditAlbumDescription] = useState('');
  const [editAlbumSlug, setEditAlbumSlug] = useState('');
  const [editAlbumCoverPhotoId, setEditAlbumCoverPhotoId] = useState('none');
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [newAlbumDescription, setNewAlbumDescription] = useState('');
  const [newAlbumSlug, setNewAlbumSlug] = useState('');
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profileSlug, setProfileSlug] = useState('');
  const [profileCoverPhotoId, setProfileCoverPhotoId] = useState('none');
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [sharePassword, setSharePassword] = useState('');
  const [createdShareUrl, setCreatedShareUrl] = useState('');
  const shouldShowUploadRedirectNotice = searchParams.get('reason') === 'missing-destination';

  const sortedEvents = useMemo(() => {
    return [...galleryData.events].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  }, [galleryData.events]);

  const albumsByEvent = useMemo(() => {
    return [...galleryData.albums]
      .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
      .reduce<Record<string, AlbumRecord[]>>((groups, album) => {
        groups[album.event_id] = [...(groups[album.event_id] ?? []), album];
        return groups;
      }, {});
  }, [galleryData.albums]);

  const photoCountsByAlbum = useMemo(() => {
    return galleryData.photos.reduce<Record<string, number>>((counts, photo) => {
      if (!photo.albumId) return counts;
      counts[photo.albumId] = (counts[photo.albumId] ?? 0) + 1;
      return counts;
    }, {});
  }, [galleryData.photos]);

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

  const eventCoversByEvent = useMemo(() => {
    return galleryData.events.reduce<Record<string, GalleryPhoto | null>>((covers, eventRecord) => {
      covers[eventRecord.id] = getCoverPhoto(photosByEvent[eventRecord.id] ?? [], eventRecord.cover_photo_id);
      return covers;
    }, {});
  }, [galleryData.events, photosByEvent]);

  const albumCoversByAlbum = useMemo(() => {
    return galleryData.albums.reduce<Record<string, GalleryPhoto | null>>((covers, album) => {
      covers[album.id] = getCoverPhoto(photosByAlbum[album.id] ?? [], album.cover_photo_id);
      return covers;
    }, {});
  }, [galleryData.albums, photosByAlbum]);

  const allPhotos = galleryData.photos;
  const profileCover = getCoverPhoto(allPhotos, profileCoverPhotoId === 'none' ? null : profileCoverPhotoId);

  useEffect(() => {
    if (!profile) return;

    setProfileDisplayName(profile.display_name ?? '');
    setProfileSlug(profile.slug ?? '');
    setProfileCoverPhotoId(profile.cover_photo_id ?? 'none');
  }, [profile]);

  const loadData = useCallback(() => {
    let cancelled = false;

    async function run() {
      setIsLoading(true);

      try {
        const data = await fetchGalleryData();
        if (!cancelled) {
          setGalleryData(data);
        }
      } catch (error) {
        toast({
          title: 'Could not load events',
          description: error instanceof Error ? error.message : 'Supabase data failed to load',
          variant: 'destructive',
        });
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
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

  if (isAuthLoading) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

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

  const handleCreateAlbum = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!albumDialogEvent) return;

    setIsSaving(true);

    try {
      await createAlbum({
        eventId: albumDialogEvent.id,
        title: newAlbumTitle,
        description: newAlbumDescription,
        slug: newAlbumSlug || undefined,
      });

      setNewAlbumTitle('');
      setNewAlbumDescription('');
      setNewAlbumSlug('');
      setAlbumDialogEvent(null);
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

  const handleUpdateEvent = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingEvent) return;

    setIsSaving(true);

    try {
      await updateEvent({
        eventId: editingEvent.id,
        title: editEventTitle,
        description: editEventDescription,
        slug: editEventSlug,
        coverPhotoId: editEventCoverPhotoId === 'none' ? null : editEventCoverPhotoId,
      });
      setEditingEvent(null);
      setEditEventTitle('');
      setEditEventDescription('');
      setEditEventSlug('');
      setEditEventCoverPhotoId('none');
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

  const handleUpdateAlbum = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingAlbum) return;

    setIsSaving(true);

    try {
      await updateAlbum({
        albumId: editingAlbum.id,
        title: editAlbumTitle,
        description: editAlbumDescription,
        slug: editAlbumSlug,
        coverPhotoId: editAlbumCoverPhotoId === 'none' ? null : editAlbumCoverPhotoId,
      });
      setEditingAlbum(null);
      setEditAlbumTitle('');
      setEditAlbumDescription('');
      setEditAlbumSlug('');
      setEditAlbumCoverPhotoId('none');
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

  const handleDeleteEvent = async (eventRecord: EventRecord) => {
    setIsSaving(true);

    try {
      await deleteEventWithPhotos(eventRecord.id);
      setDeletingEvent(null);
      setDeleteConfirmationText('');
      toast({ title: 'Event deleted' });
      loadData();
    } catch (error) {
      toast({
        title: 'Could not delete event',
        description: error instanceof Error ? error.message : 'Delete failed',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAlbum = async (album: AlbumRecord) => {
    setIsSaving(true);

    try {
      await deleteAlbumWithPhotos(album.id);
      setDeletingAlbum(null);
      setDeleteConfirmationText('');
      toast({ title: 'Album deleted' });
      loadData();
    } catch (error) {
      toast({
        title: 'Could not delete album',
        description: error instanceof Error ? error.message : 'Delete failed',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const openAddAlbumDialog = (eventRecord: EventRecord) => {
    setAlbumDialogEvent(eventRecord);
    setNewAlbumTitle('');
    setNewAlbumDescription('');
    setNewAlbumSlug('');
  };

  const openEditEventDialog = (eventRecord: EventRecord) => {
    setEditingEvent(eventRecord);
    setEditEventTitle(eventRecord.title);
    setEditEventDescription(eventRecord.description ?? '');
    setEditEventSlug(eventRecord.slug);
    setEditEventCoverPhotoId(eventRecord.cover_photo_id ?? 'none');
  };

  const openEditAlbumDialog = (album: AlbumRecord) => {
    setEditingAlbum(album);
    setEditAlbumTitle(album.title);
    setEditAlbumDescription(album.description ?? '');
    setEditAlbumSlug(album.slug);
    setEditAlbumCoverPhotoId(album.cover_photo_id ?? 'none');
  };

  const openDeleteEventDialog = (eventRecord: EventRecord) => {
    setDeletingEvent(eventRecord);
    setDeletingAlbum(null);
    setDeleteConfirmationText('');
  };

  const openDeleteAlbumDialog = (album: AlbumRecord) => {
    setDeletingAlbum(album);
    setDeletingEvent(null);
    setDeleteConfirmationText('');
  };

  const handleSaveProfilePresentation = async () => {
    if (!profile) return;

    setIsSaving(true);

    try {
      await updateProfilePresentation({
        profileId: profile.id,
        displayName: profileDisplayName,
        slug: profileSlug,
        coverPhotoId: profileCoverPhotoId === 'none' ? null : profileCoverPhotoId,
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

  const buildShareUrl = (target: ShareTarget) => {
    const baseUrl = window.location.origin;
    const currentProfileSlug = makeSlug(profileSlug || profile?.slug || 'profile');

    if (target.scope === 'profile') {
      return `${baseUrl}/${currentProfileSlug}`;
    }

    if (target.scope === 'event') {
      return `${baseUrl}/${currentProfileSlug}/${target.eventRecord.slug}`;
    }

    return `${baseUrl}/${currentProfileSlug}/${target.eventRecord.slug}/${target.album.slug}`;
  };

  const openShareDialog = (target: ShareTarget) => {
    setShareTarget(target);
    setSharePassword('');
    setCreatedShareUrl('');
  };

  const handleCreateShare = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!shareTarget || !profile) return;

    setIsSaving(true);

    try {
      await createShareLink({
        scope: shareTarget.scope as ShareScope,
        profileId: shareTarget.scope === 'profile' ? profile.id : null,
        eventId: shareTarget.scope === 'event' ? shareTarget.eventRecord.id : null,
        albumId: shareTarget.scope === 'album' ? shareTarget.album.id : null,
        password: sharePassword,
      });
      setCreatedShareUrl(buildShareUrl(shareTarget));
      toast({ title: 'Share link enabled' });
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

  const copyCreatedShareUrl = async () => {
    if (!createdShareUrl) return;

    await navigator.clipboard.writeText(createdShareUrl);
    toast({ title: 'Share link copied' });
  };

  const deleteTarget = deletingEvent ?? deletingAlbum;
  const deleteTargetType = deletingEvent ? 'event' : 'album';
  const deleteTargetName = deleteTarget?.title ?? '';
  const canConfirmDelete = deleteConfirmationText === deleteTargetName;
  const shareTargetName =
    shareTarget?.scope === 'profile'
      ? profileDisplayName || profileSlug || 'Photographer page'
      : shareTarget?.scope === 'event'
        ? shareTarget.eventRecord.title
        : shareTarget?.album.title ?? '';

  return (
    <div className="min-h-screen px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-light tracking-wide">Events & Albums</h1>
          <p className="text-sm text-muted-foreground">Create, edit, and organize gallery structure</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="secondary" className="gap-2">
            <Link to="/gallery">
              <ArrowLeft className="h-4 w-4" />
              Gallery
            </Link>
          </Button>
          <Button variant="secondary" onClick={loadData} disabled={isLoading || isSaving} className="gap-2">
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button onClick={() => setIsEventDialogOpen(true)} disabled={isSaving} className="gap-2">
            <Plus className="h-4 w-4" />
            Add Event
          </Button>
        </div>
      </header>

      {shouldShowUploadRedirectNotice && (
        <div className="mb-5 flex items-start gap-2 rounded-md border border-primary/40 bg-secondary p-3 text-sm text-muted-foreground">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-foreground" />
          <span>
            Uploads can only be added to existing events and albums. Create an event and at least one album here, then
            return to Add Photos.
          </span>
        </div>
      )}

      <Card className="mx-auto mb-4 max-w-6xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <User className="h-5 w-5" />
            Photographer Page
          </CardTitle>
          <CardDescription>Configure the public overview page at /{profileSlug || profile?.slug || 'name'}.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[160px_1fr_1fr]">
          <div className="space-y-2 md:row-span-2">
            <Label>Current cover</Label>
            <CoverPreview
              photo={profileCover}
              icon={<User className="h-6 w-6" />}
              className="aspect-[4/3] w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-display-name">Display name</Label>
            <Input
              id="profile-display-name"
              value={profileDisplayName}
              onChange={(event) => setProfileDisplayName(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-slug">Public URL slug</Label>
            <Input
              id="profile-slug"
              value={profileSlug}
              onChange={(event) => setProfileSlug(makeSlug(event.target.value))}
              placeholder="photographer-name"
            />
          </div>
          <CoverPhotoSelect
            label="Cover photo"
            photos={allPhotos}
            value={profileCoverPhotoId}
            onChange={setProfileCoverPhotoId}
          />
          <div className="flex flex-wrap gap-2 md:col-span-2">
            <Button onClick={handleSaveProfilePresentation} disabled={!profileSlug || isSaving}>
              Save Photographer Page
            </Button>
            <Button
              variant="secondary"
              className="gap-2"
              onClick={() => openShareDialog({ scope: 'profile' })}
              disabled={!profileSlug || isSaving}
            >
              <Link2 className="h-4 w-4" />
              Share Page
            </Button>
          </div>
        </CardContent>
      </Card>

      <main className="mx-auto max-w-6xl space-y-4">
        {sortedEvents.length > 0 ? (
          sortedEvents.map((eventRecord) => (
            <EventAlbumElement
              key={eventRecord.id}
              eventRecord={eventRecord}
              albums={albumsByEvent[eventRecord.id] ?? []}
              photoCountsByAlbum={photoCountsByAlbum}
              eventCover={eventCoversByEvent[eventRecord.id] ?? null}
              albumCoversByAlbum={albumCoversByAlbum}
              profileSlug={profileSlug || profile?.slug || 'name'}
              isSaving={isSaving}
              onOpenDeleteEvent={openDeleteEventDialog}
              onOpenDeleteAlbum={openDeleteAlbumDialog}
              onOpenAddAlbum={openAddAlbumDialog}
              onOpenEditEvent={openEditEventDialog}
              onOpenEditAlbum={openEditAlbumDialog}
              onOpenShare={openShareDialog}
            />
          ))
        ) : (
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-sm text-muted-foreground">No events yet.</p>
              <Button className="mt-4 gap-2" onClick={() => setIsEventDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                Add Event
              </Button>
            </CardContent>
          </Card>
        )}
      </main>

      <Dialog open={isEventDialogOpen} onOpenChange={setIsEventDialogOpen}>
        <DialogContent>
          <form onSubmit={handleCreateEvent} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add Event</DialogTitle>
              <DialogDescription>Create a new event container for albums.</DialogDescription>
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
              <Input
                id="new-event-slug"
                value={newEventSlug}
                onChange={(event) => setNewEventSlug(makeSlug(event.target.value))}
                placeholder="event-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-event-description">Description</Label>
              <Textarea
                id="new-event-description"
                value={newEventDescription}
                onChange={(event) => setNewEventDescription(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!newEventTitle || isSaving}>
                Create Event
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingEvent} onOpenChange={(open) => !open && setEditingEvent(null)}>
        <DialogContent>
          <form onSubmit={handleUpdateEvent} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Edit Event</DialogTitle>
              <DialogDescription>Update the event name and description.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="edit-event-title">Name</Label>
              <Input
                id="edit-event-title"
                value={editEventTitle}
                onChange={(event) => setEditEventTitle(event.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-event-slug">Public URL slug</Label>
              <Input
                id="edit-event-slug"
                value={editEventSlug}
                onChange={(event) => setEditEventSlug(makeSlug(event.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-event-description">Description</Label>
              <Textarea
                id="edit-event-description"
                value={editEventDescription}
                onChange={(event) => setEditEventDescription(event.target.value)}
              />
            </div>
            <CoverPhotoSelect
              label="Cover photo"
              photos={editingEvent ? galleryData.photos.filter((photo) => photo.eventId === editingEvent.id) : []}
              value={editEventCoverPhotoId}
              onChange={setEditEventCoverPhotoId}
            />
            <DialogFooter>
              <Button type="submit" disabled={!editEventTitle || isSaving}>
                Save Event
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editingAlbum} onOpenChange={(open) => !open && setEditingAlbum(null)}>
        <DialogContent>
          <form onSubmit={handleUpdateAlbum} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Edit Album</DialogTitle>
              <DialogDescription>Update the album name and description.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="edit-album-title">Name</Label>
              <Input
                id="edit-album-title"
                value={editAlbumTitle}
                onChange={(event) => setEditAlbumTitle(event.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-album-slug">Public URL slug</Label>
              <Input
                id="edit-album-slug"
                value={editAlbumSlug}
                onChange={(event) => setEditAlbumSlug(makeSlug(event.target.value))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-album-description">Description</Label>
              <Textarea
                id="edit-album-description"
                value={editAlbumDescription}
                onChange={(event) => setEditAlbumDescription(event.target.value)}
              />
            </div>
            <CoverPhotoSelect
              label="Cover photo"
              photos={editingAlbum ? photosByAlbum[editingAlbum.id] ?? [] : []}
              value={editAlbumCoverPhotoId}
              onChange={setEditAlbumCoverPhotoId}
            />
            <DialogFooter>
              <Button type="submit" disabled={!editAlbumTitle || isSaving}>
                Save Album
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!albumDialogEvent} onOpenChange={(open) => !open && setAlbumDialogEvent(null)}>
        <DialogContent>
          <form onSubmit={handleCreateAlbum} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add Album</DialogTitle>
              <DialogDescription>
                Add an album to {albumDialogEvent?.title ?? 'the selected event'}.
              </DialogDescription>
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
              <Input
                id="new-album-slug"
                value={newAlbumSlug}
                onChange={(event) => setNewAlbumSlug(makeSlug(event.target.value))}
                placeholder="album-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-album-description">Description</Label>
              <Textarea
                id="new-album-description"
                value={newAlbumDescription}
                onChange={(event) => setNewAlbumDescription(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={!newAlbumTitle || isSaving}>
                Create Album
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!shareTarget}
        onOpenChange={(open) => {
          if (!open) {
            setShareTarget(null);
            setSharePassword('');
            setCreatedShareUrl('');
          }
        }}
      >
        <DialogContent>
          <form onSubmit={handleCreateShare} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Share {shareTargetName}</DialogTitle>
              <DialogDescription>
                Create a password-protected public link. Visitors will need this password before photos are loaded.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="share-password">Password</Label>
              <Input
                id="share-password"
                type="password"
                value={sharePassword}
                onChange={(event) => setSharePassword(event.target.value)}
                autoFocus
              />
            </div>
            {createdShareUrl && (
              <div className="space-y-2 rounded-md border border-border bg-secondary/40 p-3">
                <Label>Public link</Label>
                <div className="flex gap-2">
                  <Input value={createdShareUrl} readOnly />
                  <Button type="button" variant="secondary" size="icon" onClick={copyCreatedShareUrl}>
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
            <DialogFooter>
              <Button type="submit" disabled={sharePassword.length < 4 || isSaving}>
                Create Share Link
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

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
            <DialogTitle>Delete {deleteTargetType}</DialogTitle>
            <DialogDescription>
              This will delete the entire {deleteTargetType}
              {deletingEvent ? ', including all albums and photos inside it.' : ' and all photos inside it.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Type <span className="font-medium text-foreground">{deleteTargetName}</span> to confirm.
            </p>
            <Input
              value={deleteConfirmationText}
              onChange={(event) => setDeleteConfirmationText(event.target.value)}
              placeholder={deleteTargetName}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={!canConfirmDelete || isSaving}
              onClick={() => {
                if (deletingEvent) {
                  handleDeleteEvent(deletingEvent);
                } else if (deletingAlbum) {
                  handleDeleteAlbum(deletingAlbum);
                }
              }}
            >
              Delete {deleteTargetType}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
