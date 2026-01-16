import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { photos } from '@/data/photos';
import StereoViewer from '@/components/StereoViewer';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Gallery() {
  const { isAuthenticated, logout } = useAuth();
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handlePhotoClick = (index: number) => {
    setSelectedPhotoIndex(index);
  };

  const handleCloseViewer = () => {
    setSelectedPhotoIndex(null);
  };

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (selectedPhotoIndex === null) return;

    if (direction === 'prev' && selectedPhotoIndex > 0) {
      setSelectedPhotoIndex(selectedPhotoIndex - 1);
    } else if (direction === 'next' && selectedPhotoIndex < photos.length - 1) {
      setSelectedPhotoIndex(selectedPhotoIndex + 1);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-between bg-background/80 px-4 py-4 backdrop-blur-sm">
        <h1 className="text-xl font-light tracking-wide">Greg's Photos</h1>
        <Button
          variant="ghost"
          size="icon"
          onClick={logout}
          className="text-muted-foreground hover:text-foreground"
        >
          <LogOut className="h-5 w-5" />
        </Button>
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
              <img
                src={photo.srcLeft}
                alt={photo.alt}
                className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      </main>

      {/* Full-Screen Viewer */}
      {selectedPhotoIndex !== null && (
        <StereoViewer
          photo={photos[selectedPhotoIndex]}
          onClose={handleCloseViewer}
          onPrevious={() => handleNavigate('prev')}
          onNext={() => handleNavigate('next')}
          hasPrevious={selectedPhotoIndex > 0}
          hasNext={selectedPhotoIndex < photos.length - 1}
        />
      )}
    </div>
  );
}
