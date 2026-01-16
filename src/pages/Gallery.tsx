import { useState, useRef, useCallback, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { photos } from '@/data/photos';
import StereoViewer from '@/components/StereoViewer';
import GifViewer from '@/components/GifViewer';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

type ViewMode = 'stereo' | 'gif';

export default function Gallery() {
  const { isAuthenticated, logout } = useAuth();
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('stereo');
  const fullscreenContainerRef = useRef<HTMLDivElement>(null);

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
  const handlePhotoClick = (index: number) => {
    const container = fullscreenContainerRef.current;
    if (container) {
      // Request fullscreen immediately - this is synchronous with user gesture
      if (container.requestFullscreen) {
        container.requestFullscreen().catch(() => {});
      } else if ((container as any).webkitRequestFullscreen) {
        (container as any).webkitRequestFullscreen();
      }
    }
    setSelectedPhotoIndex(index);
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (selectedPhotoIndex === null) return;

    if (direction === 'prev' && selectedPhotoIndex > 0) {
      setSelectedPhotoIndex(selectedPhotoIndex - 1);
    } else if (direction === 'next' && selectedPhotoIndex < photos.length - 1) {
      setSelectedPhotoIndex(selectedPhotoIndex + 1);
    }
  };

  const isViewerOpen = selectedPhotoIndex !== null;

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

      {/* Photo Grid */}
      <main className="px-4 pb-8">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((photo, index) => (
            <button
              key={photo.id}
              onClick={() => handlePhotoClick(index)}
              className="group relative aspect-[2/1] overflow-hidden rounded-lg bg-secondary transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
            >
              {/*
                Display raw stereo image but show only the left half as thumbnail.
                The image is 2:1 aspect ratio (left+right), we show it at 200% width
                and use object-position to show only the left half.
              */}
              <img
                src={photo.src}
                alt={photo.alt}
                className="h-full w-[200%] object-cover object-left transition-opacity group-hover:opacity-90"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      </main>

      {/* Fullscreen Container - always in DOM for immediate fullscreen request */}
      <div
        ref={fullscreenContainerRef}
        className={`fixed inset-0 z-50 bg-black ${isViewerOpen ? 'block' : 'hidden'}`}
      >
        {isViewerOpen && viewMode === 'stereo' && (
          <StereoViewer
            photo={photos[selectedPhotoIndex]}
            photoIndex={selectedPhotoIndex}
            onClose={handleCloseViewer}
            onPrevious={() => handleNavigate('prev')}
            onNext={() => handleNavigate('next')}
            hasPrevious={selectedPhotoIndex > 0}
            hasNext={selectedPhotoIndex < photos.length - 1}
          />
        )}
        {isViewerOpen && viewMode === 'gif' && (
          <GifViewer
            photo={photos[selectedPhotoIndex]}
            photoIndex={selectedPhotoIndex}
            onClose={handleCloseViewer}
            onPrevious={() => handleNavigate('prev')}
            onNext={() => handleNavigate('next')}
            hasPrevious={selectedPhotoIndex > 0}
            hasNext={selectedPhotoIndex < photos.length - 1}
          />
        )}
      </div>
    </div>
  );
}
