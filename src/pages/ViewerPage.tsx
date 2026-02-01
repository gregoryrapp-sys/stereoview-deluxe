import { Navigate, useNavigate, useParams, Link } from 'react-router-dom';
import StereoViewer from '@/components/StereoViewer';
import { getAlbumById, getAlbumPhotos } from '@/data/albums';
import { Button } from '@/components/ui/button';

export default function ViewerPage() {
  const { albumId, photoId } = useParams<{ albumId: string; photoId: string }>();
  const navigate = useNavigate();

  const album = albumId ? getAlbumById(albumId) : undefined;
  if (!album) {
    return <Navigate to="/" replace />;
  }

  const albumPhotos = getAlbumPhotos(album);
  const photoIndex = albumPhotos.findIndex((photo) => photo.id === photoId);
  const photo = albumPhotos[photoIndex];

  if (!photo) {
    return <Navigate to={`/album/${album.id}`} replace />;
  }

  const handleNavigate = (direction: 'prev' | 'next') => {
    if (direction === 'prev' && photoIndex > 0) {
      navigate(`/viewer/${album.id}/${albumPhotos[photoIndex - 1].id}`);
    }
    if (direction === 'next' && photoIndex < albumPhotos.length - 1) {
      navigate(`/viewer/${album.id}/${albumPhotos[photoIndex + 1].id}`);
    }
  };

  return (
    <div className="relative min-h-screen bg-black">
      <div className="absolute left-4 top-4 z-10">
        <Button asChild variant="secondary" size="sm">
          <Link to={`/album/${album.id}`}>Back to album</Link>
        </Button>
      </div>
      <StereoViewer
        photo={photo}
        photoIndex={photoIndex}
        photoSet={albumPhotos}
        onClose={() => navigate(`/album/${album.id}`)}
        onPrevious={() => handleNavigate('prev')}
        onNext={() => handleNavigate('next')}
        hasPrevious={photoIndex > 0}
        hasNext={photoIndex < albumPhotos.length - 1}
      />
    </div>
  );
}
