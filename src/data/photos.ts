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
  },
  {
    id: '2',
    srcLeft: '/photos/2-left.jpg',
    srcRight: '/photos/2-right.jpg',
    alt: 'Stereoscopic photo 2'
  },
  {
    id: '3',
    srcLeft: '/photos/3-left.jpg',
    srcRight: '/photos/3-right.jpg',
    alt: 'Stereoscopic photo 3'
  }
];
