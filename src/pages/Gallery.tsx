import { useState, useRef, useCallback, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { photos } from '@/data/photos';
import { albums, Album } from '@/data/albums';
import StereoViewer from '@/components/StereoViewer';
import GifViewer from '@/components/GifViewer';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ViewMode = 'stereo' | 'gif';

export default function Gallery() {
  const { isAuthenticated, logout } = useAuth();
  const [albumList, setAlbumList] = useState<Album[]>(albums);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('stereo');
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [newAlbumCover, setNewAlbumCover] = useState<File | null>(null);
  const [newAlbumCoverPreview, setNewAlbumCoverPreview] = useState<string | null>(null);

  const activeAlbum = selectedAlbumId
    ? albumList.find((album) => album.id === selectedAlbumId) ?? null
    : null;
  const activePhotos = activeAlbum?.photos ?? [];

  useEffect(() => {
    if (!newAlbumCover) {
      setNewAlbumCoverPreview(null);
      return;
    }

    const previewUrl = URL.createObjectURL(newAlbumCover);
    setNewAlbumCoverPreview(previewUrl);

    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [newAlbumCover]);

  const handleCloseViewer = useCallback(async () => {
    // Exit fullscreen first
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if ((document as any).webkitFullscreenElement) {
        await (document as any).webkitExitFullscreen();
      }
    } catch (e) {
      // Ignore errors
    }
    setSelectedPhotoIndex(null);
    setSelectedAlbumId(null);
  }, []);

  // Listen for fullscreen exit (user presses back/escape)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      if (!isFullscreen && selectedPhotoIndex !== null) {
        setSelectedPhotoIndex(null);
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [selectedPhotoIndex]);

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  // Request fullscreen synchronously in click handler (user gesture required)
  const handleAlbumClick = (albumId: string) => {
    const container = fullscreenContainerRef.current;
    if (container) {
      // Request fullscreen immediately - this is synchronous with user gesture
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      } else if ((container as any).webkitRequestFullscreen) {
        (container as any).webkitRequestFullscreen();
      }
    }
    setSelectedAlbumId(albumId);
    setSelectedPhotoIndex(0);
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (selectedPhotoIndex === null || activePhotos.length === 0) return;

    if (direction === 'prev' && selectedPhotoIndex > 0) {
      setSelectedPhotoIndex(selectedPhotoIndex - 1);
    } else if (direction === 'next' && selectedPhotoIndex < activePhotos.length - 1) {
      setSelectedPhotoIndex(selectedPhotoIndex + 1);
    }
  };

  const isViewerOpen = selectedPhotoIndex !== null;

  const handleCreateAlbum = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedTitle = newAlbumTitle.trim();
    if (!trimmedTitle) return;

    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `album-${Date.now()}`;
    const coverSrc = newAlbumCoverPreview ?? photos[0]?.src ?? '';

    const newAlbum: Album = {
      id,
      title: trimmedTitle,
      coverSrc,
      photos
    };

    setAlbumList((prev) => [newAlbum, ...prev]);
    setNewAlbumTitle('');
    setNewAlbumCover(null);
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between bg-background/80 px-4 py-4 backdrop-blur-sm">
        <h1 className="text-xl font-light tracking-wide">Greg's Photos</h1>
        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="flex rounded-lg bg-secondary p-1">
            <button
              onClick={() => setViewMode('stereo')}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                viewMode === 'stereo'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Stereo
            </button>
            <button
              onClick={() => setViewMode('gif')}
              className={`rounded-md px-3 py-1 text-sm transition-colors ${
                viewMode === 'gif'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              GIF
            </button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={logout}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Album Layout */}
      <main className="space-y-10 px-4 pb-10">
        <section className="space-y-4 rounded-2xl border border-border/60 bg-card/50 p-6 shadow-sm">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              Create New Album
            </p>
            <h2 className="mt-2 text-2xl font-light text-foreground">
              Start a fresh stereo collection
            </h2>
          </div>
          <form onSubmit={handleCreateAlbum} className="grid gap-4 md:grid-cols-[1.5fr_1fr_auto]">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground" htmlFor="album-name">
                Album name
              </label>
              <Input
                id="album-name"
                value={newAlbumTitle}
                onChange={(event) => setNewAlbumTitle(event.target.value)}
                placeholder="e.g. Lake Weekend"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground" htmlFor="album-cover">
                Cover photo
              </label>
              <Input
                id="album-cover"
                type="file"
                accept="image/*"
                onChange={(event) => setNewAlbumCover(event.target.files?.[0] ?? null)}
              />
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={!newAlbumTitle.trim()}>
                Create album
              </Button>
            </div>
          </form>
          <div className="grid gap-3 md:grid-cols-[auto_1fr] md:items-center">
            <div className="aspect-square h-24 overflow-hidden rounded-xl border border-border/60 bg-secondary">
              {newAlbumCoverPreview ? (
                <img
                  src={newAlbumCoverPreview}
                  alt="New album cover preview"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs uppercase tracking-widest text-muted-foreground">
                  Preview
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Upload a cover image to personalize your album thumbnail. Click any album to jump
              straight into the stereo viewer.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Your Albums
              </p>
              <h2 className="mt-2 text-2xl font-light text-foreground">
                Browse your stereo collections
              </h2>
            </div>
            <span className="text-sm text-muted-foreground">{albumList.length} albums</span>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {albumList.map((album) => (
              <button
                key={album.id}
                onClick={() => handleAlbumClick(album.id)}
                className="group flex flex-col gap-3 text-left focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
              >
                <div className="relative aspect-square overflow-hidden rounded-2xl border border-border/60 bg-secondary shadow-sm transition-transform group-hover:scale-[1.02]">
                  <img
                    src={album.coverSrc}
                    alt={`${album.title} cover`}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div>
                  <p className="text-base font-medium text-foreground">{album.title}</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {album.photos.length} photos
                  </p>
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>

      {/* Fullscreen Container - always in DOM for immediate fullscreen request */}
      <div
        ref={fullscreenContainerRef}
        className={`fixed inset-0 z-50 bg-black ${isViewerOpen ? 'block' : 'hidden'}`}
      >
        {isViewerOpen && viewMode === 'stereo' && activePhotos[selectedPhotoIndex] && (
          <StereoViewer
            photo={activePhotos[selectedPhotoIndex]}
            photoIndex={selectedPhotoIndex}
            onClose={handleCloseViewer}
            onPrevious={() => handleNavigate('prev')}
            onNext={() => handleNavigate('next')}
            hasPrevious={selectedPhotoIndex > 0}
            hasNext={selectedPhotoIndex < activePhotos.length - 1}
          />
        )}
        {isViewerOpen && viewMode === 'gif' && activePhotos[selectedPhotoIndex] && (
          <GifViewer
            photo={activePhotos[selectedPhotoIndex]}
            photoIndex={selectedPhotoIndex}
            onClose={handleCloseViewer}
            onPrevious={() => handleNavigate('prev')}
            onNext={() => handleNavigate('next')}
            hasPrevious={selectedPhotoIndex > 0}
            hasNext={selectedPhotoIndex < activePhotos.length - 1}
          />
        )}
      </div>
    </div>
  );
}
