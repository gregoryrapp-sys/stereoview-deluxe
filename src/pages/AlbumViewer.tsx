import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { useAlbums } from '@/contexts/AlbumContext';
import type { Photo } from '@/data/photos';
import PhotoGallery from '@/components/PhotoGallery';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];

function normalizeDropboxLink(link: string) {
  const cleaned = link.split('?')[0];
  return cleaned.replace(/\/$/, '');
}

function toProxyUrl(link: string) {
  const normalized = normalizeDropboxLink(link);
  return `https://r.jina.ai/http://${normalized.replace(/^https?:\/\//, '')}`;
}

function extractImageUrls(rawHtml: string): string[] {
  const urls = new Set<string>();
  const escapedMatches = rawHtml.match(/https:\/\/[^"\s]+/g) ?? [];
  const directMatches = rawHtml.match(/https?:\/\/[^"\s]+/g) ?? [];

  const normalizeUrl = (value: string) =>
    value
      .replace(/\\u002F/g, '/')
      .replace(/\\u0026/g, '&')
      .replace(/\\/g, '');

  [...escapedMatches, ...directMatches].forEach((match) => {
    const normalized = normalizeUrl(match);
    urls.add(normalized);
  });

  return Array.from(urls)
    .filter((url) => IMAGE_EXTENSIONS.some((ext) => url.toLowerCase().includes(ext)))
    .map((url) => {
      if (url.includes('dropbox.com')) {
        return url.replace('?dl=0', '?raw=1').replace('?dl=1', '?raw=1');
      }
      return url;
    });
}

export default function AlbumViewer() {
  const { isAuthenticated, logout } = useAuth();
  const { getAlbum } = useAlbums();
  const { albumId } = useParams();
  const navigate = useNavigate();
  const album = useMemo(() => (albumId ? getAlbum(albumId) : undefined), [albumId, getAlbum]);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let isActive = true;

    const loadPhotos = async () => {
      if (!album) return;
      setIsLoading(true);
      setError('');

      try {
        const response = await fetch(toProxyUrl(album.dropboxFolderLink));
        if (!response.ok) {
          throw new Error('Unable to reach the Dropbox folder link.');
        }

        const html = await response.text();
        const urls = extractImageUrls(html);

        if (!urls.length) {
          throw new Error('No images were found in the shared Dropbox folder.');
        }

        const nextPhotos = urls.map((url, index) => ({
          id: `${album.id}-${index}`,
          src: url,
          alt: `Album image ${index + 1}`
        }));

        if (isActive) {
          setPhotos(nextPhotos);
        }
      } catch (err) {
        if (isActive) {
          setError(err instanceof Error ? err.message : 'Unable to load album images.');
          setPhotos([]);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    loadPhotos();

    return () => {
      isActive = false;
    };
  }, [album]);

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  if (!album) {
    return <Navigate to="/user" replace />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading album images from Dropbox...
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <p className="text-xs text-muted-foreground">
          Make sure the folder link is publicly shared and contains image files.
        </p>
        <button
          onClick={() => navigate('/user')}
          className="text-sm font-medium text-primary hover:underline"
        >
          Back to albums
        </button>
      </div>
    );
  }

  return (
    <PhotoGallery
      title={album.title}
      photos={photos}
      onLogout={logout}
      onBack={() => navigate('/user')}
    />
  );
}
