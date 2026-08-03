import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Check,
  Cloud,
  AlertCircle,
  Copy,
  ArrowLeft,
  FolderOpen,
  ImagePlus,
  Images,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
  Upload,
  User,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useAuth } from '@/contexts/AuthContext';
import {
  createAlbum,
  createEvent,
  fetchDropboxPhotos,
  fetchDropboxPhoto,
  deleteAlbumWithPhotos,
  deleteEventWithPhotos,
  deletePhoto,
  fetchGalleryData,
  movePhotos,
  GalleryData,
  GalleryPhoto,
  makeSlug,
  updateAlbum,
  updateEvent,
  updateProfilePresentation,
  uploadSbsPhoto,
  DropboxFile,
} from '@/services/galleryService';
import type { AlbumRecord, EventRecord } from '@/types/database';
import StereoThumbnail from '@/components/StereoThumbnail';
import ThumbnailGrid from '@/components/ThumbnailGrid';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { ObjectCoverPickerDialog } from '@/components/ObjectCoverPickerDialog';

import { PrivacySettings } from '@/components/PrivacySettings';
import { COLLECTION_SORT_OPTIONS, getCoverPhoto, resolveAlbumCover, resolveEventCover } from '@/lib/galleryUtils';
import { useDropboxCovers } from '@/hooks/useDropboxCovers';

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
      {photo ? <StereoThumbnail photo={photo} /> : (
        <div className="flex h-full w-full items-center justify-center text-muted-foreground">{icon}</div>
      )}
    </div>
  );
}

function buildPublicUrl(profileSlug: string, eventSlug?: string, albumSlug?: string) {
  const parts = [window.location.origin, profileSlug, eventSlug, albumSlug].filter(Boolean);
  return parts.join('/');
}

export default function EventAlbumManagement() {
  const { eventId, albumId } = useParams();
  const { isAuthenticated, isLoading: isAuthLoading, profile, user, refreshProfile } = useAuth();
  const [searchParams] = useSearchParams();
  const [galleryData, setGalleryData] = useState<GalleryData>({ events: [], albums: [], photos: [] });
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEventDialogOpen, setIsEventDialogOpen] = useState(false);
  const [isAlbumDialogOpen, setIsAlbumDialogOpen] = useState(false);
  const [coverPicker, setCoverPicker] = useState<'profile' | EventRecord | AlbumRecord | null>(null);
  const [deletingEvent, setDeletingEvent] = useState<EventRecord | null>(null);
  const [deletingAlbum, setDeletingAlbum] = useState<AlbumRecord | null>(null);
  const [deletingPhoto, setDeletingPhoto] = useState<(GalleryPhoto & { isDropbox?: boolean }) | null>(null);
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profileSlug, setProfileSlug] = useState('');
  const [profileCoverPhotoId, setProfileCoverPhotoId] = useState<string | null>(null);
  const [profileDropboxCoverAlbumId, setProfileDropboxCoverAlbumId] = useState<string | null>(null);
  const [profileDropboxCoverImageName, setProfileDropboxCoverImageName] = useState<string | null>(null);
  const [newEventTitle, setNewEventTitle] = useState('');
  const [newEventDescription, setNewEventDescription] = useState('');
  const [newEventSlug, setNewEventSlug] = useState('');
  const [eventTitle, setEventTitle] = useState('');
  const [eventDescription, setEventDescription] = useState('');
  const [eventSlug, setEventSlug] = useState('');
  const [eventCoverPhotoId, setEventCoverPhotoId] = useState<string | null>(null);
  const [eventDropboxCoverAlbumId, setEventDropboxCoverAlbumId] = useState<string | null>(null);
  const [eventDropboxCoverImageName, setEventDropboxCoverImageName] = useState<string | null>(null);
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [newAlbumDescription, setNewAlbumDescription] = useState('');
  const [newAlbumSlug, setNewAlbumSlug] = useState('');
  const [newAlbumSourceType, setNewAlbumSourceType] = useState<'upload' | 'dropbox'>('upload');
  const [newAlbumDropboxUrl, setNewAlbumDropboxUrl] = useState('');
  const [albumTitle, setAlbumTitle] = useState('');
  const [albumDescription, setAlbumDescription] = useState('');
  const [albumSlug, setAlbumSlug] = useState('');
  const [albumCoverPhotoId, setAlbumCoverPhotoId] = useState<string | null>(null);
  const [albumDropboxCoverImageName, setAlbumDropboxCoverImageName] = useState<string | null>(null);
  const [albumDropboxUrl, setAlbumDropboxUrl] = useState('');
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadNamePrefix, setUploadNamePrefix] = useState('');
  const [dropboxPhotos, setDropboxPhotos] = useState<DropboxFile[]>([]);
  const [isDropboxLoading, setIsDropboxLoading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [isMovePhotosDialogOpen, setIsMovePhotosDialogOpen] = useState(false);
  const [moveDestinationEventId, setMoveDestinationEventId] = useState<string | null>(null);
  const [moveDestinationAlbumId, setMoveDestinationAlbumId] = useState<string | null>(null);
  const shouldShowUploadRedirectNotice = searchParams.get('reason') === 'missing-destination';

  // Public / Share state declarations
  const [profileIsPublic, setProfileIsPublic] = useState(true);
  const [profilePassword, setProfilePassword] = useState('');
  const [eventIsPublic, setEventIsPublic] = useState(true);
  const [eventPassword, setEventPassword] = useState('');
  const [albumIsPublic, setAlbumIsPublic] = useState(true);
  const [albumPassword, setAlbumPassword] = useState('');
  const [profilePasswordDirty, setProfilePasswordDirty] = useState(false);
  const [eventPasswordDirty, setEventPasswordDirty] = useState(false);
  const [albumPasswordDirty, setAlbumPasswordDirty] = useState(false);
  //const [shareLinks, setShareLinks] = useState<any[]>([]); // Replace 'any' with your ShareLinkRecord type

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
    setProfileDropboxCoverAlbumId((profile as any).dropbox_cover_album_id ?? null);
    setProfileDropboxCoverImageName((profile as any).dropbox_cover_image_name ?? null);
    setProfileIsPublic(profile.is_public ?? true);
    setProfilePasswordDirty(false);
  }, [profile]);

  const handleProfilePasswordChange = (password: string | null) => {
    setProfilePasswordDirty(true);
    setProfilePassword(password ?? '');
  };

  const handleEventPasswordChange = (password: string | null) => {
    setEventPasswordDirty(true);
    setEventPassword(password ?? '');
  };

  const handleAlbumPasswordChange = (password: string | null) => {
    setAlbumPasswordDirty(true);
    setAlbumPassword(password ?? '');
  };
  
  const handleCoverSelect = (photo: (GalleryPhoto & { isDropbox?: boolean }) | null) => {
    if (!coverPicker) return;

    if (coverPicker === 'profile') {
      if (photo === null) {
        setProfileCoverPhotoId(null);
        setProfileDropboxCoverAlbumId(null);
        setProfileDropboxCoverImageName(null);
      } else if (photo.isDropbox && photo.albumId) {
        setProfileDropboxCoverImageName(photo.alt); // photo.alt is the filename
        setProfileDropboxCoverAlbumId(photo.albumId);
        setProfileCoverPhotoId(null);
      } else {
        setProfileCoverPhotoId(photo.id);
        setProfileDropboxCoverAlbumId(null);
        setProfileDropboxCoverImageName(null);
      }
      toast({ title: 'Cover photo selected.', description: 'Remember to save the photographer page to apply the change.' });
    } else if ('owner_id' in coverPicker) {
      // Event
      if (photo === null) {
        setEventCoverPhotoId(null);
        setEventDropboxCoverAlbumId(null);
        setEventDropboxCoverImageName(null);
      } else if (photo.isDropbox && photo.albumId) {
        setEventDropboxCoverImageName(photo.alt); // photo.alt is the filename
        setEventDropboxCoverAlbumId(photo.albumId);
        setEventCoverPhotoId(null);
      } else {
        setEventCoverPhotoId(photo.id);
        setEventDropboxCoverAlbumId(null);
        setEventDropboxCoverImageName(null);
      }
      toast({ title: 'Cover photo selected.', description: 'Remember to save the event to apply the change.' });
    } else {
      // Album
      if (photo === null) {
        setAlbumCoverPhotoId(null);
        setAlbumDropboxCoverImageName(null);
      } else {
        handleSetAlbumCover(photo);
      }
    }
    setCoverPicker(null);
  };

  const { currentCoverPhotoId, currentDropboxCoverName } = useMemo(() => {
    if (!coverPicker) return { currentCoverPhotoId: null, currentDropboxCoverName: null };
    if (coverPicker === 'profile') {
      return { currentCoverPhotoId: profileCoverPhotoId, currentDropboxCoverName: profileDropboxCoverImageName };
    }
    if ('owner_id' in coverPicker) {
      // Event
      return { currentCoverPhotoId: eventCoverPhotoId, currentDropboxCoverName: eventDropboxCoverImageName };
    }
    // Album
    return { currentCoverPhotoId: albumCoverPhotoId, currentDropboxCoverName: albumDropboxCoverImageName };
  }, [
    coverPicker,
    profileCoverPhotoId,
    profileDropboxCoverImageName, eventCoverPhotoId, eventDropboxCoverImageName,
    albumCoverPhotoId, albumDropboxCoverImageName,
  ]);

  const selectedEvent = useMemo(
    () => galleryData.events.find((event) => event.id === eventId) ?? null,
    [eventId, galleryData.events],
  );

  const eventAlbums = useMemo(
    () => galleryData.albums.filter((album) => album.event_id === eventId),
    [eventId, galleryData.albums],
  );

  const { dropboxCoverUrls, setDropboxCoverUrls } = useDropboxCovers(galleryData.events, galleryData.albums, eventAlbums);

  useEffect(() => {
    if (!eventDropboxCoverAlbumId || !eventDropboxCoverImageName) return;
    const album = galleryData.albums.find((a) => a.id === eventDropboxCoverAlbumId);
    if (!album || !album.dropbox_folder_url) return;

    const coverKey = `event-cover:${eventDropboxCoverAlbumId}:${eventDropboxCoverImageName}`;
    if (dropboxCoverUrls[coverKey]) return;

    const fetchCover = async () => {
      try {
        const photo = await fetchDropboxPhoto(album.dropbox_folder_url!, eventDropboxCoverImageName);
        setDropboxCoverUrls((prev) => ({ ...prev, [coverKey]: { src: photo.src, name: photo.name } }));
      } catch (error) {
        console.error("Failed to fetch event's dropbox cover", error);
      }
    };
    fetchCover();
  }, [eventDropboxCoverAlbumId, eventDropboxCoverImageName, galleryData.albums, dropboxCoverUrls, setDropboxCoverUrls]);

  useEffect(() => {
    if (!profileDropboxCoverAlbumId || !profileDropboxCoverImageName) return;
    const album = galleryData.albums.find((a) => a.id === profileDropboxCoverAlbumId);
    if (!album || !album.dropbox_folder_url) return;

    const coverKey = `profile-cover:${profileDropboxCoverAlbumId}:${profileDropboxCoverImageName}`;
    if (dropboxCoverUrls[coverKey]) return;

    const fetchCover = async () => {
      try {
        const photo = await fetchDropboxPhoto(album.dropbox_folder_url!, profileDropboxCoverImageName);
        setDropboxCoverUrls((prev) => ({ ...prev, [coverKey]: { src: photo.src, name: photo.name } }));
      } catch (error) {
        console.error("Failed to fetch profile's dropbox cover", error);
      }
    };
    fetchCover();
  }, [profileDropboxCoverAlbumId, profileDropboxCoverImageName, galleryData.albums, dropboxCoverUrls, setDropboxCoverUrls]);

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
  const isDropboxAlbum = selectedAlbum?.source_type === 'dropbox';

  const displayPhotos = useMemo(() => {
    if (isDropboxAlbum) {
      return dropboxPhotos.map((file) => ({
        id: file.id,
        src: file.src,
        alt: file.name,
        isDropbox: true,
        albumId: selectedAlbum?.id,
        eventId: selectedAlbum?.event_id,
        storagePath: undefined,
        rightSrc: undefined,
        created_at: file.client_modified,
      }));
    }
    // Explicitly map properties to ensure type consistency and add isDropbox flag
    return albumPhotos.map((p) => ({
      ...p,
      isDropbox: false,
    }));
  }, [isDropboxAlbum, dropboxPhotos, albumPhotos, selectedAlbum]);

  const profileCover = useMemo(() => {
    if (!profile) return null;

    if (profileDropboxCoverAlbumId && profileDropboxCoverImageName) {
      const coverKey = `profile-cover:${profileDropboxCoverAlbumId}:${profileDropboxCoverImageName}`;
      const coverInfo = dropboxCoverUrls[coverKey];
      if (coverInfo) {
        return {
          id: coverKey,
          src: coverInfo.src,
          alt: coverInfo.name,
          albumId: profileDropboxCoverAlbumId,
        } as GalleryPhoto;
      }
      // A dropbox cover is selected, but the URL is not yet fetched.
      // Return null to avoid showing the wrong (fallback) image.
      return null;
    }

    // If no dropbox cover is selected, check for an uploaded one.
    // This handles both an explicit selection (ID is set) and "automatic" (ID is null),
    // where getCoverPhoto will fall back to the first photo in the list.
    // The initial state from the DB is loaded into these state variables, so this is safe.
    return getCoverPhoto(galleryData.photos, profileCoverPhotoId);
  }, [profile, profileCoverPhotoId, profileDropboxCoverAlbumId, profileDropboxCoverImageName, galleryData.photos, dropboxCoverUrls]);

  const profileCoverAlbum = useMemo(() => profileCover?.albumId ? galleryData.albums.find((a) => a.id === profileCover.albumId) ?? null : null, [profileCover, galleryData.albums]);
  const eventCover = useMemo(() => {
    if (!selectedEvent) return null;

    if (eventDropboxCoverAlbumId && eventDropboxCoverImageName) {
      const coverKey = `event-cover:${eventDropboxCoverAlbumId}:${eventDropboxCoverImageName}`;
      const coverInfo = dropboxCoverUrls[coverKey];
      if (coverInfo) {
        return {
          id: coverKey,
          src: coverInfo.src,
          alt: coverInfo.name,
          eventId: selectedEvent.id,
          albumId: eventDropboxCoverAlbumId,
        } as GalleryPhoto;
      }
      // A dropbox cover is selected, but the URL is not yet fetched.
      // Return null to avoid showing the wrong (fallback) image.
      return null;
    }

    // If no dropbox cover is selected, check for an uploaded one, or "automatic".
    const eventPhotos = photosByEvent[selectedEvent.id] ?? [];
    // Use the state variable, which could be an explicit ID or null for "automatic".
    const uploadedCover = getCoverPhoto(eventPhotos, eventCoverPhotoId);
    if (uploadedCover) return uploadedCover;

    // If no uploaded photo is available or selected, check for a default cover from a linked Dropbox album.
    const coverInfo = dropboxCoverUrls[`event:${selectedEvent.id}`];
    if (coverInfo) {
      return {
        id: `event-cover-${selectedEvent.id}`,
        src: coverInfo.src,
        alt: coverInfo.name,
        eventId: selectedEvent.id,
      } as GalleryPhoto;
    }

    return null; // No cover found
  }, [selectedEvent, eventCoverPhotoId, eventDropboxCoverAlbumId, eventDropboxCoverImageName, photosByEvent, dropboxCoverUrls]);
  const albumCover = useMemo(() => {
    if (!selectedAlbum) return null;
    if (albumDropboxCoverImageName) {
      return (displayPhotos.find((p) => p.isDropbox && p.alt === albumDropboxCoverImageName) as GalleryPhoto) ?? null;
    }
    return getCoverPhoto(albumPhotos, albumCoverPhotoId);
  }, [selectedAlbum, albumDropboxCoverImageName, albumCoverPhotoId, displayPhotos, albumPhotos]);
  
  const parentEventCover = useMemo(() => {
    if (!selectedAlbumEvent) return null;
    // We only care about uploaded photos for this check
    if (selectedAlbumEvent.dropbox_cover_album_id) return null;

    const eventPhotos = photosByEvent[selectedAlbumEvent.id] ?? [];
    // Check against the saved cover_photo_id from the database record
    return getCoverPhoto(eventPhotos, selectedAlbumEvent.cover_photo_id);
  }, [selectedAlbumEvent, photosByEvent]);


  const handleToggleSelectPhoto = (photoId: string) => {
    setSelectedPhotoIds((prev) =>
      prev.includes(photoId) ? prev.filter((id) => id !== photoId) : [...prev, photoId]
    );
  };

  const selectablePhotoIds = useMemo(() => {
    const albumCoverId = albumCover?.id;
    const eventCoverId = parentEventCover?.id;

    return displayPhotos
      .filter(p => !p.isDropbox && p.id !== albumCoverId && p.id !== eventCoverId)
      .map(p => p.id);
  }, [displayPhotos, albumCover, parentEventCover]);

  const handleSelectAllPhotos = () => {
    // Check if every selectable photo is already in the selected list
    const allSelectableAreSelected =
      selectablePhotoIds.length > 0 && 
      selectablePhotoIds.every((id) => selectedPhotoIds.includes(id));

    if (allSelectableAreSelected) {
      // If all are selected, clear the selection
      setSelectedPhotoIds([]);
    } else {
      // Otherwise, select all available IDs
      setSelectedPhotoIds(selectablePhotoIds);
    }
  };

  const moveDestinationAlbums = useMemo(() => {
    if (!moveDestinationEventId) return [];
    return galleryData.albums.filter(
      (a) => a.event_id === moveDestinationEventId && a.id !== selectedAlbum?.id && a.source_type === 'upload'
    );
  }, [moveDestinationEventId, galleryData.albums, selectedAlbum]);

  const handleConfirmMovePhotos = async () => {
    if (!moveDestinationAlbumId || selectedPhotoIds.length === 0) return;
    
    setIsSaving(true);
    try {
      // Ensure 'movePhotos' is available from 'galleryService'
      await movePhotos(selectedPhotoIds, moveDestinationAlbumId);
      
      toast({ title: 'Photos moved successfully' });
      setIsMovePhotosDialogOpen(false);
      setSelectedPhotoIds([]); // Clear selection after move
      setMoveDestinationEventId(null);
      setMoveDestinationAlbumId(null);
      loadData(); // Refresh UI to reflect changes
    } catch (error) {
      toast({
        title: 'Could not move photos',
        description: error instanceof Error ? error.message : 'Move failed',
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

/* --------Removed the following code block because it was commented out and not used in the current implementation. If you need to use share links in the future, you can uncomment and adapt this code as necessary.
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
  };*/


  useEffect(() => {
    if (!selectedEvent) return;
    setEventTitle(selectedEvent.title);
    setEventDescription(selectedEvent.description ?? '');
    setEventSlug(selectedEvent.slug);
    setEventCoverPhotoId(selectedEvent.cover_photo_id);
    setEventDropboxCoverAlbumId(selectedEvent.dropbox_cover_album_id);
    setEventDropboxCoverImageName(selectedEvent.dropbox_cover_image_name);
    setEventIsPublic(selectedEvent.is_public ?? true);
    setEventPasswordDirty(false);
  }, [selectedEvent]);

  useEffect(() => {
    if (!selectedAlbum) return;
    setAlbumTitle(selectedAlbum.title);
    setAlbumDescription(selectedAlbum.description ?? '');
    setAlbumSlug(selectedAlbum.slug);
    setAlbumCoverPhotoId(selectedAlbum.cover_photo_id);
    setAlbumDropboxCoverImageName(selectedAlbum.dropbox_cover_image_name);
    setAlbumDropboxUrl(selectedAlbum.dropbox_folder_url ?? '');
    setAlbumIsPublic(selectedAlbum.is_public ?? true);
    setAlbumPasswordDirty(false);
  }, [selectedAlbum]);

  useEffect(() => {
    if (!isDropboxAlbum || !selectedAlbum?.dropbox_folder_url) {
      setDropboxPhotos([]);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setIsDropboxLoading(true);
      try {
        const files = await fetchDropboxPhotos(selectedAlbum.dropbox_folder_url!);
        if (!cancelled) {
          setDropboxPhotos(files);
        }
      } catch (error) {
        toast({
          title: 'Could not load Dropbox photos',
          description: error instanceof Error ? error.message : 'Unknown error',
          variant: 'destructive',
        });
        if (!cancelled) {
          setDropboxPhotos([]);
        }
      } finally {
        if (!cancelled) {
          setIsDropboxLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [isDropboxAlbum, selectedAlbum?.dropbox_folder_url]);

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
        dropboxCoverAlbumId: profileDropboxCoverAlbumId,
        dropboxCoverImageName: profileDropboxCoverImageName,
        isPublic: profileIsPublic,
        password: profilePasswordDirty ? profilePassword || null : undefined,
      });
      toast({ title: 'Photographer page saved' });
      if (refreshProfile) {
        await refreshProfile();
      }
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
        dropboxCoverAlbumId: eventDropboxCoverAlbumId,
        dropboxCoverImageName: eventDropboxCoverImageName,
        isPublic: eventIsPublic, // Add this
        password: eventPasswordDirty ? eventPassword || null : undefined,
      });
      toast({ title: 'Event saved' });
      setGalleryData((prevData) => {
        const newEvents = prevData.events.map((event) =>
          event.id === selectedEvent.id
            ? {
                ...event,
                title: eventTitle,
                description: eventDescription,
                slug: eventSlug,
                cover_photo_id: eventCoverPhotoId,
                dropbox_cover_album_id: eventDropboxCoverAlbumId,
                dropbox_cover_image_name: eventDropboxCoverImageName,
                is_public: eventIsPublic,
                password: eventPasswordDirty ? eventPassword || null : selectedEvent.password,
              }
            : event,
        );
        return { ...prevData, events: newEvents };
      });
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
        dropbox_folder_url: newAlbumSourceType === 'dropbox' ? newAlbumDropboxUrl : null,
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
      console.error('Album creation failed:', error);
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
        coverPhotoId: albumCoverPhotoId,
        dropboxCoverImageName: albumDropboxCoverImageName,
        dropbox_folder_url: selectedAlbum.source_type === 'dropbox' ? albumDropboxUrl : null,
        isPublic: albumIsPublic, // Add this
        password: albumPasswordDirty ? albumPassword || null : undefined,
      });
      toast({ title: 'Album saved' });
      setGalleryData((prevData) => {
        const newAlbums = prevData.albums.map((album) =>
          album.id === selectedAlbum.id
            ? {
                ...album,
                title: albumTitle,
                description: albumDescription,
                slug: albumSlug,
                cover_photo_id: albumCoverPhotoId,
                dropbox_cover_image_name: albumDropboxCoverImageName,
                dropbox_folder_url: selectedAlbum.source_type === 'dropbox' ? albumDropboxUrl : null,
                is_public: albumIsPublic,
                password: albumPasswordDirty ? albumPassword || null : selectedAlbum.password,
              }
            : album,
        );
        return { ...prevData, albums: newAlbums };
      });
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

  const handleSetAlbumCover = (photo: (typeof displayPhotos)[0]) => {
    if (photo.isDropbox) {
      setAlbumDropboxCoverImageName(photo.alt); // photo.alt is the filename
      setAlbumCoverPhotoId(null);
    } else {
      setAlbumCoverPhotoId(photo.id);
      setAlbumDropboxCoverImageName(null);
    }
    toast({ title: 'Cover photo selected.', description: 'Remember to save the album to apply the change.' });
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

  const deleteTarget = deletingEvent ?? deletingAlbum ?? deletingPhoto;
  const deleteTargetName = deleteTarget?.title ?? (deleteTarget as any)?.alt ?? '';

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setIsSaving(true);
    try {
      if (deletingEvent) {
        await deleteEventWithPhotos(deletingEvent.id);
        toast({ title: 'Event deleted' });
      } else if (deletingAlbum) {
        await deleteAlbumWithPhotos(deletingAlbum.id);
        toast({ title: 'Album deleted' });
      } else if (deletingPhoto && deletingPhoto.storagePath && !deletingPhoto.isDropbox) {
        await deletePhoto(deletingPhoto.id, deletingPhoto.storagePath);
        toast({ title: 'Photo deleted' });
      } else if (deletingPhoto?.isDropbox) {
        throw new Error("Dropbox photos cannot be deleted from this interface.");
      }
      setDeletingEvent(null);
      setDeletingAlbum(null);
      setDeletingPhoto(null);
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
              Up
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
          <Link to="/">
            <User className="h-4 w-4" />
            Public Site
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
    <div className="min-h-screen px-20 py-20 sm:px-4 sm:py-6">
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
              <CardContent className="grid gap-4 md:grid-cols-[104px_1fr_1fr]">
                <button type="button" onClick={() => setCoverPicker('profile')} className="text-left">
                  <Label>Cover</Label>
                  <CoverPreview
                    photo={profileCover}
                    icon={<User className="h-6 w-6" />}
                    className="mt-1 aspect-[4/3] w-full"
                  />
                </button>
                <div className="space-y-2">
                  <Label htmlFor="profile-display-name">Display name</Label>
                  <Input id="profile-display-name" value={profileDisplayName} onChange={(event) => setProfileDisplayName(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="profile-slug">Public URL slug</Label>
                  <Input id="profile-slug" value={profileSlug} onChange={(event) => setProfileSlug(makeSlug(event.target.value))} />
                </div>
                <div className="md:col-span-3">
                  <PrivacySettings
                    isPublic={profileIsPublic}
                    onIsPublicChange={setProfileIsPublic}
                    passwordSet={!!profile?.password} // Assumes profile query payload tracks if password column is not null
                    onPasswordChange={handleProfilePasswordChange}
                  />
                </div>
                <div className="flex flex-wrap gap-2 md:col-span-3">
                  <Button variant="secondary" onClick={saveProfile} disabled={!profileSlug || isSaving}>
                    Save Photographer Page
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-light">Events</h2>
              <Button onClick={() => setIsEventDialogOpen(true)} variant="secondary" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Event
              </Button>
            </div>

            <ThumbnailGrid
              items={galleryData.events}
              sortOptions={COLLECTION_SORT_OPTIONS}
              emptyMessage="No events yet. Click 'Add Event' to create one."
              renderItem={(eventRecord) => {
                  const eventPhotos = photosByEvent[eventRecord.id] ?? [];
                  const cover = resolveEventCover(eventRecord, eventPhotos, dropboxCoverUrls);
                  const albums = galleryData.albums.filter((album) => album.event_id === eventRecord.id);
  
                  return (
                    <Card key={eventRecord.id} className="overflow-hidden">
                      <div className="aspect-[3/2] bg-secondary">
                        {cover ? <StereoThumbnail photo={cover} /> : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <FolderOpen className="h-6 w-6" />
                          </div>
                        )}
                      </div>
                      <CardContent className="space-y-2 p-3">
                        <div>
                          <h3 className="truncate text-sm font-medium">{eventRecord.title}</h3>
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>{albums.length} {albums.length === 1 ? 'album' : 'albums'}</span>
                            <span className="font-mono">{new Date(eventRecord.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button asChild variant="secondary" size="icon" className="h-9 w-9" title="Manage Event">
                            <Link to={`/manage/events/${eventRecord.id}`}><Settings className="h-4 w-4" /></Link>
                          </Button>
                          <Button variant="secondary" size="icon" className="h-9 w-9" onClick={() => setDeletingEvent(eventRecord)} title="Delete Event">
                            <Trash2 className="h-4 w-4"  />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                }}
            />
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
              <CardContent className="grid gap-4 md:grid-cols-[104px_1fr_1fr]">
                <button type="button" onClick={() => selectedEvent && setCoverPicker(selectedEvent)} className="text-left">
                  <Label>Cover</Label>
                  <div className="mt-1 aspect-[4/3] w-full shrink-0 overflow-hidden rounded-md bg-secondary">
                    {eventCover ? (
                      <StereoThumbnail photo={eventCover} />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                        <FolderOpen className="h-6 w-6" />
                      </div>
                    )}
                  </div>
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
                
                <div className="md:col-span-3">
                  <PrivacySettings
                    isPublic={eventIsPublic}
                    onIsPublicChange={setEventIsPublic}
                    passwordSet={!!selectedEvent?.password}
                    onPasswordChange={handleEventPasswordChange}
                  />
                </div>
                <div className="flex flex-wrap gap-2 md:col-span-2 md:col-start-1">
                  <Button variant="secondary" onClick={saveEvent} disabled={!eventTitle || !eventSlug || isSaving}>
                    Save Event
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-light">Albums</h2>
              <Button onClick={() => setIsAlbumDialogOpen(true)} variant="secondary" className="gap-2">
                <Plus className="h-4 w-4" />
                Add Album
              </Button>
            </div>

            <ThumbnailGrid
              items={eventAlbums}
              sortOptions={COLLECTION_SORT_OPTIONS}
              emptyMessage="This event has no albums yet. Click 'Add Album' to create one."
              renderItem={(album) => {
                  const photos = photosByAlbum[album.id] ?? [];
                  const cover = resolveAlbumCover(album, photos, dropboxCoverUrls);
  
                  return (
                    <Card key={album.id} className="overflow-hidden">
                      <div className="aspect-[3/2] bg-secondary">
                        {cover ? <StereoThumbnail photo={cover} /> : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <Images className="h-6 w-6" />
                          </div>
                        )}
                      </div>
                      <CardContent className="space-y-2 p-3">
                        <div>
                          <h3 className="truncate text-sm font-medium">{album.title}</h3>
                          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                            {album.source_type === 'dropbox' ? (
                              <span className="flex items-center gap-1.5 font-medium text-sky-600 dark:text-sky-400">
                                <Cloud className="h-3 w-3" />
                                Dropbox Live
                              </span>
                            ) : (
                              <span>{photos.length} {photos.length === 1 ? 'photo' : 'photos'}</span>
                            )}
                            <span className="font-mono">{new Date(album.created_at).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button asChild variant="secondary" size="icon" className="h-9 w-9" title="Manage Album">
                            <Link to={`/manage/events/${selectedEvent.id}/albums/${album.id}`}><Settings className="h-4 w-4" /></Link>
                          </Button>
                          <Button variant="secondary" size="icon" className="h-9 w-9" onClick={() => setDeletingAlbum(album)} title="Delete Album">
                            <Trash2 className="h-4 w-4"  />
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                }}
            />
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
              <CardContent className="grid gap-4 md:grid-cols-[104px_1fr_1fr]">
                <button type="button" onClick={() => selectedAlbum && setCoverPicker(selectedAlbum)} className="text-left">
                  <Label>Cover</Label>
                  <CoverPreview
                    photo={albumCover}
                    icon={<Images className="h-6 w-6" />}
                    className="mt-1 aspect-[4/3] w-full"
                  />
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
                <div className={`space-y-2 ${selectedAlbum.source_type === 'dropbox' ? '' : 'hidden'}`}>
                  <Label htmlFor="album-dropbox-url">Dropbox Folder URL</Label>
                  <Input id="album-dropbox-url" value={albumDropboxUrl} onChange={(event) => setAlbumDropboxUrl(event.target.value)}
                    placeholder="Paste a public Dropbox folder link"
                  />
                </div>
                
                <div className="md:col-span-3">
                  <PrivacySettings
                    isPublic={albumIsPublic}
                    onIsPublicChange={setAlbumIsPublic}
                    passwordSet={!!selectedAlbum?.password}
                    onPasswordChange={handleAlbumPasswordChange}
                  />
                </div>
                {selectedAlbum.source_type === 'upload' && (
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
                      <Button type="submit" variant="secondary" className="self-end gap-2" disabled={uploadFiles.length === 0 || isSaving}>
                        <ImagePlus className="h-4 w-4" />
                        {isSaving ? uploadProgress || 'Uploading...' : 'Upload'}
                      </Button>
                    </form>
                  </div>
                )}
                <div className="flex flex-wrap gap-2 md:col-span-2 md:col-start-1">
                  <Button variant="secondary" onClick={saveAlbum} disabled={!albumTitle || !albumSlug || isSaving}>
                    Save Album
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-light">Photos in this album</h2>
                <p className="text-sm text-muted-foreground">
                  {displayPhotos.length} {displayPhotos.length === 1 ? 'photo' : 'photos'}
                  {isDropboxAlbum && (
                    <span className="font-medium text-sky-600 dark:text-sky-400">
                      {' · '} <Cloud className="inline h-3 w-3" /> Dropbox Live
                    </span>
                  )}
                </p>
              </div>
              {albumPhotos.length > 0 && selectedAlbum.source_type === 'upload' && (
                <div className="flex gap-2">
                  <Button variant="outline" onClick={handleSelectAllPhotos} disabled={isSaving || selectablePhotoIds.length === 0}>
                    {selectedPhotoIds.length === selectablePhotoIds.length && selectablePhotoIds.length > 0
                      ? 'Deselect All'
                      : 'Select All'}
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setIsMovePhotosDialogOpen(true)}
                    disabled={selectedPhotoIds.length === 0 || isSaving}
                  >
                    Move Selected ({selectedPhotoIds.length})
                  </Button>
                </div>
              )}
            </div>

            {isDropboxLoading ? (
              <div className="flex items-center justify-center rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                <Cloud className="mr-2 h-4 w-4 animate-pulse" />
                Loading photos from Dropbox...
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {displayPhotos.map((photo) => {
                  const isSelectedCover = photo.isDropbox
                    ? photo.alt === albumDropboxCoverImageName
                    : photo.id === albumCoverPhotoId;
                  const isSelectedForMove = selectedPhotoIds.includes(photo.id);
                  const isUnmovableCover =
                    !photo.isDropbox &&
                    (photo.id === albumCover?.id || photo.id === parentEventCover?.id);
                  return (
                    <div key={photo.id} className="relative">
                      <Card
                        className={`overflow-hidden transition-all ${
                          isSelectedCover ? 'ring-2 ring-emerald-500' : ''
                        } ${isSelectedForMove ? 'ring-2 ring-blue-500' : ''}`}
                      >
                        <div className="aspect-[2/1] bg-secondary">
                          <StereoThumbnail photo={photo as GalleryPhoto} />
                        </div>
                        <CardContent className="flex items-center justify-between gap-2 p-2">
                          <p className="truncate text-xs text-muted-foreground">{photo.alt || 'Untitled photo'}</p>
                          {!photo.isDropbox && (
                            <Button
                              variant="secondary"
                              size="icon"
                              className="h-9 w-9 shrink-0"
                              onClick={() => setDeletingPhoto(photo)}
                              disabled={isSaving}
                              title="Delete Photo"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                      {!photo.isDropbox && (
                        <div className="absolute left-2 top-2">
                          <Checkbox
                            id={`select-${photo.id}`}
                            checked={isSelectedForMove}
                            onCheckedChange={() => !isUnmovableCover && handleToggleSelectPhoto(photo.id)}
                            className="h-5 w-5 rounded-full border-white bg-black/30 data-[state=checked]:bg-blue-600 data-[state=checked]:text-white"
                            disabled={isUnmovableCover}
                            title={isUnmovableCover ? 'This photo is a cover image and cannot be moved.' : 'Select photo'}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </main>

      {coverPicker && (
        <ObjectCoverPickerDialog
          open={!!coverPicker}
          onClose={() => setCoverPicker(null)}
          object={coverPicker}
          galleryData={galleryData}
          onSelect={handleCoverSelect}
          currentCoverPhotoId={currentCoverPhotoId}
          currentDropboxCoverName={currentDropboxCoverName}
          dropboxCoverUrls={dropboxCoverUrls}
        />
      )}

      <Dialog open={isMovePhotosDialogOpen} onOpenChange={setIsMovePhotosDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {selectedPhotoIds.length} Photos</DialogTitle>
            <DialogDescription>
              Select a destination event and album. Only 'upload' type albums are shown.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="dest-event">Destination Event</Label>
              <Select
                value={moveDestinationEventId ?? ''}
                onValueChange={(value) => {
                  setMoveDestinationEventId(value);
                  setMoveDestinationAlbumId(null);
                }}
              >
                <SelectTrigger id="dest-event">
                  <SelectValue placeholder="Select an event" />
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
              <Label htmlFor="dest-album">Destination Album</Label>
              <Select
                value={moveDestinationAlbumId ?? ''}
                onValueChange={(value) => setMoveDestinationAlbumId(value)}
                disabled={!moveDestinationEventId || moveDestinationAlbums.length === 0}
              >
                <SelectTrigger id="dest-album">
                  <SelectValue placeholder="Select an album" />
                </SelectTrigger>
                <SelectContent>
                  {moveDestinationAlbums.map((album) => (
                    <SelectItem key={album.id} value={album.id}>
                      {album.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {moveDestinationEventId && moveDestinationAlbums.length === 0 && (
                <p className="text-xs text-muted-foreground">This event has no other 'upload' albums.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsMovePhotosDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="secondary" disabled={isSaving || !moveDestinationAlbumId} onClick={handleConfirmMovePhotos}>
              {isSaving ? 'Moving...' : 'Confirm Move'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeletingEvent(null);
            setDeletingAlbum(null);
            setDeletingPhoto(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deletingEvent ? 'event' : deletingAlbum ? 'album' : 'photo'}</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deleteTargetName}"?
              {deletingEvent && ' This will delete the entire event, including all albums and photos inside it.'}
              {deletingAlbum && ' This will delete the entire album and all photos inside it.'}
              {deletingPhoto && ' This will permanently delete the photo.'}
              {' '}This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setDeletingEvent(null);
              setDeletingAlbum(null);
              setDeletingPhoto(null);
            }}>
              Cancel
            </Button>
            <Button variant="secondary" disabled={isSaving} onClick={confirmDelete}>
              Yes, delete
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
              <Button type="submit" variant="secondary" disabled={!newEventTitle || isSaving}>
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
              <Button
                type="submit"
                variant="secondary"
                disabled={!newAlbumTitle || isSaving || (newAlbumSourceType === 'dropbox' && !newAlbumDropboxUrl)}
              >
                Create Album
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
