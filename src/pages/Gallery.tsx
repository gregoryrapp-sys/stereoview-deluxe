import { Navigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { photos } from '@/data/photos';
import PhotoGallery from '@/components/PhotoGallery';

export default function Gallery() {
  const { isAuthenticated, logout } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <PhotoGallery
      title="Greg's Photos"
      photos={photos}
      onLogout={logout}
    />
  );
}
