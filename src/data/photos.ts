export interface Photo {
  id: string;
  srcLeft: string;
  srcRight: string;
  srcGif: string;
  alt: string;
}

// Stereoscopic photos - left and right halves stored separately
// Add more entries as needed with paths to your split images
export const photos: Photo[] = [
  {
    id: '1',
    srcLeft: '/photos/1-left.jpg',
    srcRight: '/photos/1-right.jpg',
    srcGif: '/photos/1-wiggle.gif',
    alt: 'Stereoscopic photo 1'
  },
  {
    id: '2',
    srcLeft: '/photos/2-left.jpg',
    srcRight: '/photos/2-right.jpg',
    srcGif: '/photos/2-wiggle.gif',
    alt: 'Two friends celebrating at dinner'
  },
  {
    id: '3',
    srcLeft: '/photos/3-left.jpg',
    srcRight: '/photos/3-right.jpg',
    srcGif: '/photos/3-wiggle.gif',
    alt: 'Three friends on the dance floor'
  },
  {
    id: '4',
    srcLeft: '/photos/4-left.jpg',
    srcRight: '/photos/4-right.jpg',
    srcGif: '/photos/4-wiggle.gif',
    alt: 'Friends dancing at the party'
  },
  {
    id: '5',
    srcLeft: '/photos/5-left.jpg',
    srcRight: '/photos/5-right.jpg',
    srcGif: '/photos/5-wiggle.gif',
    alt: 'Group carrying friend at celebration'
  },
  {
    id: '6',
    srcLeft: '/photos/6-left.jpg',
    srcRight: '/photos/6-right.jpg',
    srcGif: '/photos/6-wiggle.gif',
    alt: 'Crop test'
  }
];
