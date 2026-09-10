export interface Photo {
  id: string;
  /** Path to the raw stereo image (side-by-side left/right) */
  src: string;
  alt: string;
}

type DropboxPhoto = Omit<Photo, 'src'> & {
  /** File path within a shared Dropbox folder OR a full Dropbox shared link. */
  filePath: string;
};

const normalizeDropboxShareLink = (shareUrl: string) => {
  const [baseUrl] = shareUrl.split('?');
  return `${baseUrl}?raw=1`;
};

const buildDropboxSharedFileUrl = (folderUrl: string, filePath: string) => {
  if (filePath.startsWith('http')) {
    return normalizeDropboxShareLink(filePath);
  }

  const baseFolderUrl = folderUrl.replace(/\?.*$/, '').replace(/\/$/, '');
  const encodedPath = filePath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${baseFolderUrl}/${encodedPath}?raw=1`;
};

const dropboxFolderShareUrl = import.meta.env.VITE_DROPBOX_FOLDER_SHARE_URL ?? '';

const dropboxPhotos: DropboxPhoto[] = [
  // Example:
  // { id: '1', filePath: 'stereo-photo-1.jpeg', alt: 'Stereoscopic photo 1' }
];

const localPhotos: Photo[] = [
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

const resolvedDropboxPhotos: Photo[] = dropboxFolderShareUrl
  ? dropboxPhotos.map((photo) => ({
      id: photo.id,
      alt: photo.alt,
      src: buildDropboxSharedFileUrl(dropboxFolderShareUrl, photo.filePath)
    }))
  : [];

// Stereoscopic photos - raw side-by-side images that get split on load.
// Prefer Dropbox shared folder links when configured (no token needed).
export const photos: Photo[] =
  resolvedDropboxPhotos.length > 0 ? resolvedDropboxPhotos : localPhotos;
