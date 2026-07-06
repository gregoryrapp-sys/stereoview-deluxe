import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ImagePlus, Shield, Upload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { PHOTOS_BUCKET, supabase } from '@/lib/supabase';
import type { AlbumRecord, AppRole, EventRecord, Profile } from '@/types/database';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';

function safeFileName(name: string) {
  return name.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-');
}

export default function Admin() {
  const { isAuthenticated, isAdmin, isLoading: isAuthLoading, user } = useAuth();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [albums, setAlbums] = useState<AlbumRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedOwnerId, setSelectedOwnerId] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedAlbumId, setSelectedAlbumId] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [albumTitle, setAlbumTitle] = useState('');
  const [albumDescription, setAlbumDescription] = useState('');
  const [photoAlt, setPhotoAlt] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const loadAdminData = useCallback(async () => {
    setIsLoading(true);

    const [profilesResult, eventsResult, albumsResult] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at', { ascending: false }),
      supabase.from('events').select('*').order('created_at', { ascending: false }),
      supabase.from('albums').select('*').order('created_at', { ascending: false }),
    ]);

    setIsLoading(false);

    if (profilesResult.error || eventsResult.error || albumsResult.error) {
      toast({
        title: 'Could not load admin data',
        description:
          profilesResult.error?.message ?? eventsResult.error?.message ?? albumsResult.error?.message,
        variant: 'destructive',
      });
      return;
    }

    setProfiles(profilesResult.data);
    setEvents(eventsResult.data);
    setAlbums(albumsResult.data);

    if (!selectedOwnerId) {
      setSelectedOwnerId(profilesResult.data[0]?.id ?? user?.id ?? '');
    }
    if (!selectedEventId) {
      setSelectedEventId(eventsResult.data[0]?.id ?? '');
    }
    if (!selectedAlbumId) {
      setSelectedAlbumId(albumsResult.data[0]?.id ?? '');
    }
  }, [selectedAlbumId, selectedEventId, selectedOwnerId, user?.id]);

  useEffect(() => {
    if (isAuthenticated && isAdmin) {
      loadAdminData();
    }
  }, [isAuthenticated, isAdmin, loadAdminData]);

  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/gallery" replace />;
  }

  const createEvent = async (event: React.FormEvent) => {
    event.preventDefault();

    const { error } = await supabase.from('events').insert({
      owner_id: selectedOwnerId,
      title: eventTitle,
      description: eventDescription || null,
    });

    if (error) {
      toast({ title: 'Could not create event', description: error.message, variant: 'destructive' });
      return;
    }

    setEventTitle('');
    setEventDescription('');
    toast({ title: 'Event created' });
    loadAdminData();
  };

  const createAlbum = async (event: React.FormEvent) => {
    event.preventDefault();

    const { error } = await supabase.from('albums').insert({
      event_id: selectedEventId,
      title: albumTitle,
      description: albumDescription || null,
    });

    if (error) {
      toast({ title: 'Could not create album', description: error.message, variant: 'destructive' });
      return;
    }

    setAlbumTitle('');
    setAlbumDescription('');
    toast({ title: 'Album created' });
    loadAdminData();
  };

  const uploadPhoto = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!selectedFile || !selectedAlbumId || !user) return;

    const selectedAlbum = albums.find((album) => album.id === selectedAlbumId);
    const selectedEvent = events.find((eventRecord) => eventRecord.id === selectedAlbum?.event_id);
    const ownerId = selectedEvent?.owner_id ?? user.id;
    const fileName = safeFileName(selectedFile.name);
    const storagePath = `${ownerId}/${selectedAlbumId}/${Date.now()}-${fileName}`;

    const uploadResult = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(storagePath, selectedFile, {
        cacheControl: '3600',
        upsert: false,
      });

    if (uploadResult.error) {
      toast({ title: 'Could not upload photo', description: uploadResult.error.message, variant: 'destructive' });
      return;
    }

    const insertResult = await supabase.from('photos').insert({
      album_id: selectedAlbumId,
      storage_path: storagePath,
      alt: photoAlt || selectedFile.name,
    });

    if (insertResult.error) {
      toast({ title: 'Photo uploaded but record failed', description: insertResult.error.message, variant: 'destructive' });
      return;
    }

    setSelectedFile(null);
    setPhotoAlt('');
    toast({ title: 'Photo uploaded' });
  };

  const updateRole = async (profileId: string, role: AppRole) => {
    const { error } = await supabase.from('profiles').update({ role }).eq('id', profileId);

    if (error) {
      toast({ title: 'Could not update role', description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: 'Role updated' });
    loadAdminData();
  };

  return (
    <div className="min-h-screen px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-light tracking-wide">Admin</h1>
          <p className="text-sm text-muted-foreground">Events, albums, photo uploads, and user roles</p>
        </div>
        <Button variant="secondary" onClick={loadAdminData} disabled={isLoading}>
          Refresh
        </Button>
      </header>

      <main className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Shield className="h-5 w-5" />
              Users
            </CardTitle>
            <CardDescription>Profiles are created when users sign in or are invited.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {profiles.map((profile) => (
              <div key={profile.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{profile.display_name ?? profile.email ?? profile.id}</p>
                  <p className="truncate text-xs text-muted-foreground">{profile.email}</p>
                </div>
                <Select value={profile.role} onValueChange={(value: AppRole) => updateRole(profile.id, value)}>
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">user</SelectItem>
                    <SelectItem value="admin">admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Events and Albums</CardTitle>
            <CardDescription>Create the hierarchy that gallery users will see.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <form onSubmit={createEvent} className="space-y-3">
              <div className="space-y-2">
                <Label>Owner</Label>
                <Select value={selectedOwnerId} onValueChange={setSelectedOwnerId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose user" />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.display_name ?? profile.email ?? profile.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-title">Event title</Label>
                <Input id="event-title" value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event-description">Description</Label>
                <Textarea
                  id="event-description"
                  value={eventDescription}
                  onChange={(e) => setEventDescription(e.target.value)}
                />
              </div>
              <Button type="submit" variant="secondary" disabled={!selectedOwnerId || !eventTitle}>
                Create Event
              </Button>
            </form>

            <form onSubmit={createAlbum} className="space-y-3 border-t pt-6">
              <div className="space-y-2">
                <Label>Event</Label>
                <Select value={selectedEventId} onValueChange={setSelectedEventId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose event" />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map((event) => (
                      <SelectItem key={event.id} value={event.id}>
                        {event.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="album-title">Album title</Label>
                <Input id="album-title" value={albumTitle} onChange={(e) => setAlbumTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="album-description">Description</Label>
                <Textarea
                  id="album-description"
                  value={albumDescription}
                  onChange={(e) => setAlbumDescription(e.target.value)}
                />
              </div>
              <Button type="submit" variant="secondary" disabled={!selectedEventId || !albumTitle}>
                Create Album
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ImagePlus className="h-5 w-5" />
              Photos
            </CardTitle>
            <CardDescription>Upload side-by-side stereo images into Supabase Storage.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={uploadPhoto} className="space-y-3">
              <div className="space-y-2">
                <Label>Album</Label>
                <Select value={selectedAlbumId} onValueChange={setSelectedAlbumId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose album" />
                  </SelectTrigger>
                  <SelectContent>
                    {albums.map((album) => (
                      <SelectItem key={album.id} value={album.id}>
                        {album.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="photo-alt">Alt text</Label>
                <Input id="photo-alt" value={photoAlt} onChange={(e) => setPhotoAlt(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="photo-file">Image file</Label>
                <Input
                  id="photo-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <Button type="submit" variant="secondary" disabled={!selectedAlbumId || !selectedFile} className="gap-2">
                <Upload className="h-4 w-4" />
                Upload Photo
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
