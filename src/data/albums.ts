import { photos, Photo } from '@/data/photos';

export interface Album {
  id: string;
  name: string;
  creatorId: string;
  isPublic: boolean;
  password?: string;
  photoIds: string[];
}

export const albums: Album[] = [
  {
    id: 'album-1',
    name: 'Wedding Favorites',
    creatorId: 'u1',
    isPublic: true,
    photoIds: ['1', '2', '3'],
  },
  {
    id: 'album-2',
    name: 'Party Night',
    creatorId: 'u2',
    isPublic: false,
    password: 'party123',
    photoIds: ['4', '5'],
  },
  {
    id: 'album-3',
    name: 'Travel Highlights',
    creatorId: 'u1',
    isPublic: true,
    photoIds: ['6', '1'],
  },
];

export const getAlbumById = (id: string) => albums.find((album) => album.id === id);

export const getAlbumPhotos = (album: Album): Photo[] =>
  album.photoIds.map((photoId) => photos.find((photo) => photo.id === photoId)).filter(Boolean) as Photo[];

export const getPhotoById = (id: string) => photos.find((photo) => photo.id === id);

export const getPublicAlbums = () => albums.filter((album) => album.isPublic);

export const getUserAlbums = (userId: string) => albums.filter((album) => album.creatorId === userId);
