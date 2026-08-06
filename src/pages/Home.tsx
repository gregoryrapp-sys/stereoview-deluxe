import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Camera, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  fetchDropboxFileBlob,
  fetchDropboxPhoto,
  fetchPublicPhotographers,
  PhotographerDirectoryItem,
} from '@/services/galleryService';
import StereoThumbnail from '@/components/StereoThumbnail';
import { toast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [photographers, setPhotographers] = useState<PhotographerDirectoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loadedPhotographers: PhotographerDirectoryItem[] = [];

    async function run() {
      setIsLoading(true);
      try {
        const data = await fetchPublicPhotographers();
        if (!cancelled) {
          loadedPhotographers = data;
          setPhotographers(data);

          data.forEach(async (photographer) => {
            if (!photographer.dropboxCoverFolderUrl || !photographer.dropboxCoverImageName) return;

            try {
              const photo = await fetchDropboxPhoto(
                photographer.dropboxCoverFolderUrl,
                photographer.dropboxCoverImageName,
              );
              const blob = await fetchDropboxFileBlob({
                folderUrl: photographer.dropboxCoverFolderUrl,
                fileName: photo.name,
              });
              const src = URL.createObjectURL(blob);

              if (cancelled) {
                URL.revokeObjectURL(src);
                return;
              }

              loadedPhotographers = loadedPhotographers.map((item) =>
                item.id === photographer.id
                  ? { ...item, coverPhoto: { id: photo.id, src, alt: photo.name } }
                  : item,
              );
              setPhotographers(loadedPhotographers);
            } catch (error) {
              console.error(`Failed to fetch Dropbox cover for photographer ${photographer.id}`, error);
            }
          });
        }
      } catch (error) {
        toast({
          title: 'Could not load photographers',
          description: error instanceof Error ? error.message : 'Directory failed to load',
          variant: 'destructive',
        });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
      loadedPhotographers.forEach((photographer) => {
        const src = photographer.coverPhoto?.src;
        if (src?.startsWith('blob:')) URL.revokeObjectURL(src);
      });
    };
  }, []);

  return (
    <div className="min-h-screen px-4 py-6">
      <header className="mx-auto mb-6 flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-light tracking-wide">Stereo Photos</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? 'Loading public pages...' : 'Browse public photographer pages'}
          </p>
        </div>
        {isAuthenticated ? (
          <Button asChild variant="secondary" className="gap-2">
            <Link to="/gallery">
              <User className="h-4 w-4" />
              My Private Gallery
            </Link>
          </Button>
        ) : (
          <Button asChild variant="secondary" className="gap-2">
            <Link to="/login">
              <User className="h-4 w-4" />
              Photographer Login
            </Link>
          </Button>
        )}
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!isLoading && photographers.length === 0 && (
          <div className="rounded-md border border-border p-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
            No public photographer pages are available yet.
          </div>
        )}

        {photographers.map((photographer) => (
          <Link key={photographer.id} to={`/${photographer.slug}`}>
            <Card className="overflow-hidden transition-colors hover:bg-accent">
              <div className="aspect-[3/2] bg-secondary">
                {photographer.coverPhoto?.src ? (
                  <StereoThumbnail photo={photographer.coverPhoto} />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <Camera className="h-10 w-10" />
                  </div>
                )}
              </div>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <User className="h-5 w-5" />
                  {photographer.display_name ?? photographer.slug}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground">/{photographer.slug}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </main>
    </div>
  );
}
