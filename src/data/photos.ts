export interface Photo {
  id: string;
  /** Path to the raw stereo image (side-by-side left/right) */
  src: string;
  alt: string;
}

// Stereoscopic photos - raw side-by-side images that get split on load
// Add more entries as needed with paths to your stereo images
export const photos: Photo[] = [
  {
    id: '1',
    src: '/photos/raw/stereo-photo-1.jpeg',
    alt: 'Stereoscopic photo 1'
  },
  {
    id: '2',
    src: '/photos/raw/IMG_1543.jpeg',
    alt: 'Two friends celebrating at dinner'
  },
  {
    id: '3',
    src: '/photos/raw/IMG_2824.jpeg',
    alt: 'Three friends on the dance floor'
  },
  {
    id: '4',
    src: '/photos/raw/IMG_2911.jpeg',
    alt: 'Friends dancing at the party'
  },
  {
    id: '5',
    src: '/photos/raw/IMG_3084.jpeg',
    alt: 'Group carrying friend at celebration'
  },
  {
    id: '6',
    src: '/photos/raw/Crop test.jpeg',
    alt: 'Crop test'
  }
];
