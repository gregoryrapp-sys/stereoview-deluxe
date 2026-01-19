import { photos, Photo } from '@/data/photos';

export interface Album {
  id: string;
  title: string;
  coverSrc: string;
  photos: Photo[];
}

export const albums: Album[] = [
  {
    id: 'celebrations',
    title: 'Celebrations',
    coverSrc: photos[1].src,
    photos
  },
  {
    id: 'dance-floor',
    title: 'Dance Floor',
    coverSrc: photos[2].src,
    photos
  },
  {
    id: 'favorites',
    title: 'Favorites',
    coverSrc: photos[0].src,
    photos
  }
];
