import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Edit, FolderOpen, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  createAlbum,
  createEvent,
  deleteAlbumWithPhotos,
  deleteEventWithPhotos,
  fetchGalleryData,
  GalleryData,
  updateAlbum,
  updateEvent,
} from '@/services/galleryService';
import type { AlbumRecord, EventRecord } from '@/types/database';
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

interface EventAlbumElementProps {
  eventRecord: EventRecord;
  albums: AlbumRecord[];
  photoCountsByAlbum: Record<string, number>;
  isSaving: boolean;
  onOpenDeleteEvent: (eventRecord: EventRecord) => void;
  onOpenDeleteAlbum: (album: AlbumRecord) => void;
  onOpenAddAlbum: (eventRecord: EventRecord) => void;
  onOpenEditEvent: (eventRecord: EventRecord) => void;
  onOpenEditAlbum: (album: AlbumRecord) => void;
}

function EventAlbumElement({
  eventRecord,
  albums,
  photoCountsByAlbum,
  isSaving,
  onOpenDeleteEvent,
  onOpenDeleteAlbum,
  onOpenAddAlbum,
  onOpenEditEvent,
  onOpenEditAlbum,
}: EventAlbumElementProps) {
  return (
    <section className="rounded-md border border-border bg-card">
      <div className="space-y-4 border-b border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-muted-foreground" />
              <h2 className="truncate text-xl font-light">{eventRecord.title || 'Untitled event'}</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {albums.length} {albums.length === 1 ? 'album' : 'albums'}
            </p>
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
            <Button variant="destructive" size="sm" className="gap-2" onClick={() => onOpenDeleteEvent(eventRecord)} disabled={isSaving}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {eventRecord.description || 'No description'}
        </p>
      </div>

      <div className="space-y-3 p-4">
        {albums.length > 0 ? (
          albums.map((album) => {
            const photoCount = photoCountsByAlbum[album.id] ?? 0;

            return (
              <div key={album.id} className="rounded-md border border-border bg-secondary/40 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-medium">{album.title || 'Untitled album'}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{album.description || 'No description'}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {photoCount} {photoCount === 1 ? 'photo' : 'photos'}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" className="gap-2" onClick={() => onOpenEditAlbum(album)} disabled={isSaving}>
                      <Edit className="h-4 w-4" />
                      Edit
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

export default function EventAlbumManagement() {
  const { isAuthenticated, isLoading: isAuthLoading, user } = useAuth();
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
  const [editEventTitle, setEditEventTitle] = useState('');
  const [editEventDescription, setEditEventDescription] = useState('');
  const [editAlbumTitle, setEditAlbumTitle] = useState('');
  const [editAlbumDescription, setEditAlbumDescription] = useState('');
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [newAlbumDescription, setNewAlbumDescription] = useState('');
  const [deleteConfirmationText, setDeleteConfirmationText] = useState('');
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
      });

      setNewEventTitle('');
      setNewEventDescription('');
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
      });

      setNewAlbumTitle('');
      setNewAlbumDescription('');
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
      });
      setEditingEvent(null);
      setEditEventTitle('');
      setEditEventDescription('');
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
      });
      setEditingAlbum(null);
      setEditAlbumTitle('');
      setEditAlbumDescription('');
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
  };

  const openEditEventDialog = (eventRecord: EventRecord) => {
    setEditingEvent(eventRecord);
    setEditEventTitle(eventRecord.title);
    setEditEventDescription(eventRecord.description ?? '');
  };

  const openEditAlbumDialog = (album: AlbumRecord) => {
    setEditingAlbum(album);
    setEditAlbumTitle(album.title);
    setEditAlbumDescription(album.description ?? '');
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

  const deleteTarget = deletingEvent ?? deletingAlbum;
  const deleteTargetType = deletingEvent ? 'event' : 'album';
  const deleteTargetName = deleteTarget?.title ?? '';
  const canConfirmDelete = deleteConfirmationText === deleteTargetName;

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

      <main className="mx-auto max-w-6xl space-y-4">
        {sortedEvents.length > 0 ? (
          sortedEvents.map((eventRecord) => (
            <EventAlbumElement
              key={eventRecord.id}
              eventRecord={eventRecord}
              albums={albumsByEvent[eventRecord.id] ?? []}
              photoCountsByAlbum={photoCountsByAlbum}
              isSaving={isSaving}
              onOpenDeleteEvent={openDeleteEventDialog}
              onOpenDeleteAlbum={openDeleteAlbumDialog}
              onOpenAddAlbum={openAddAlbumDialog}
              onOpenEditEvent={openEditEventDialog}
              onOpenEditAlbum={openEditAlbumDialog}
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
                onChange={(event) => setNewEventTitle(event.target.value)}
                autoFocus
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
              <Label htmlFor="edit-event-description">Description</Label>
              <Textarea
                id="edit-event-description"
                value={editEventDescription}
                onChange={(event) => setEditEventDescription(event.target.value)}
              />
            </div>
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
              <Label htmlFor="edit-album-description">Description</Label>
              <Textarea
                id="edit-album-description"
                value={editAlbumDescription}
                onChange={(event) => setEditAlbumDescription(event.target.value)}
              />
            </div>
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
                onChange={(event) => setNewAlbumTitle(event.target.value)}
                autoFocus
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
