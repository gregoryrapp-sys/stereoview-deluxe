export interface Photo {
  id: string;
  srcLeft: string;
  srcRight: string;
  alt: string;
}

// Stereoscopic photos - left and right halves stored separately
// Add more entries as needed with paths to your split images
export const photos: Photo[] = [
  {
    id: '1',
    srcLeft: '/photos/1-left.jpg',
    srcRight: '/photos/1-right.jpg',
    alt: 'Stereoscopic photo 1'
  }
];
