import stereoPhoto1 from '@/assets/stereo-photo-1.jpeg';

export interface Photo {
  id: string;
  src: string;
  alt: string;
}

// Stereoscopic photos - add more imports and entries as needed
export const photos: Photo[] = [
  {
    id: '1',
    src: stereoPhoto1,
    alt: 'Stereoscopic photo 1'
  },
  {
    id: '2',
    src: 'https://placehold.co/2000x1000/16213e/3a4a6a?text=Stereo+Photo+2',
    alt: 'Stereoscopic photo 2'
  },
  {
    id: '3',
    src: 'https://placehold.co/2000x1000/0f3460/2a5a8a?text=Stereo+Photo+3',
    alt: 'Stereoscopic photo 3'
  }
];
