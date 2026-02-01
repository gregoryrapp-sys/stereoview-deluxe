import { Link } from 'react-router-dom';
import { getPublicAlbums, getAlbumPhotos } from '@/data/albums';
import { users } from '@/data/users';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Camera, UserPlus } from 'lucide-react';

export default function Landing() {
  const publicAlbums = getPublicAlbums();

  return (
    <div className="min-h-screen px-6 py-10">
      <header className="mx-auto flex max-w-6xl flex-col gap-6 rounded-2xl border border-border bg-card px-8 py-10">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-3 rounded-full bg-secondary px-4 py-2">
              <Camera className="h-5 w-5 text-foreground" />
              <span className="text-sm font-medium uppercase tracking-[0.2em] text-muted-foreground">
                StereoViewer
              </span>
            </div>
            <div>
              <h1 className="text-4xl font-light tracking-wide text-foreground">
                Welcome to Stereo Viewer
              </h1>
              <p className="mt-3 max-w-2xl text-muted-foreground">
                A home for stereoscopic 3D photos. Explore public albums below or sign
                in to manage your own.
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild variant="secondary" className="gap-2">
              <a href="mailto:hello@stereoviewer.com">
                <UserPlus className="h-4 w-4" />
                Request New Account
              </a>
            </Button>
            <Button asChild className="gap-2">
              <Link to="/login">Log In</Link>
            </Button>
          </div>
        </div>
      </header>

      <section className="mx-auto mt-10 max-w-6xl">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-light tracking-wide text-foreground">
            Public Albums
          </h2>
          <p className="text-sm text-muted-foreground">
            Tap any album to preview the stereoscopic set
          </p>
        </div>

        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {publicAlbums.map((album) => {
            const creator = users.find((user) => user.id === album.creatorId);
            const coverPhoto = getAlbumPhotos(album)[0];

            return (
              <Card key={album.id} className="overflow-hidden">
                <CardHeader className="space-y-1">
                  <CardTitle className="text-lg font-medium">{album.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {creator ? `By ${creator.name}` : 'Shared album'}
                  </p>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Link
                    to={`/album/${album.id}`}
                    className="group block overflow-hidden rounded-lg border border-border"
                  >
                    {coverPhoto ? (
                      <img
                        src={coverPhoto.src}
                        alt={coverPhoto.alt}
                        className="h-48 w-[200%] object-cover object-left transition-transform duration-300 group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-48 items-center justify-center bg-secondary text-muted-foreground">
                        No photos yet
                      </div>
                    )}
                  </Link>
                  <Button asChild variant="outline" className="w-full">
                    <Link to={`/album/${album.id}`}>View Album</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    </div>
  );
}
