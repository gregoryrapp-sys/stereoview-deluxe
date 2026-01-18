import { DropboxPhoto } from './types';

const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.avif'];

const isSharedLink = (input: string) => {
  try {
    const url = new URL(input);
    return url.hostname.includes('dropbox.com') && (url.pathname.startsWith('/s/') || url.pathname.startsWith('/sh/'));
  } catch {
    return false;
  }
};

const toDropboxPath = (input: string) => {
  if (input.startsWith('/')) return input;
  try {
    const url = new URL(input);
    if (url.hostname.includes('dropbox.com')) {
      if (url.pathname.startsWith('/home')) {
        return decodeURIComponent(url.pathname.replace('/home', '')) || '/';
      }
    }
  } catch {
    // ignore
  }
  return input;
};

const isImageEntry = (name: string) => {
  const lower = name.toLowerCase();
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

const dropboxRequest = async (endpoint: string, accessToken: string, body: Record<string, unknown>) => {
  const response = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || 'Dropbox request failed');
  }

  return response.json();
};

export const getTemporaryLink = async (accessToken: string, path: string) => {
  const response = await dropboxRequest('files/get_temporary_link', accessToken, { path });
  return response.link as string;
};

export const listDropboxPhotos = async (accessToken: string, folderUrl: string) => {
  if (!accessToken) {
    throw new Error('Dropbox access token is required.');
  }

  const entries: Array<{ id: string; name: string; path_lower: string; '.tag': string }> = [];

  if (isSharedLink(folderUrl)) {
    const response = await dropboxRequest('sharing/list_shared_link_files', accessToken, {
      shared_link: { url: folderUrl },
      direct_only: true
    });
    entries.push(...(response.entries ?? []));
  } else {
    const path = toDropboxPath(folderUrl);
    const response = await dropboxRequest('files/list_folder', accessToken, {
      path,
      recursive: false,
      include_media_info: false
    });
    entries.push(...(response.entries ?? []));
  }

  const imageEntries = entries.filter((entry) => entry['.tag'] === 'file' && isImageEntry(entry.name));

  const photos = await Promise.all(
    imageEntries.map(async (entry) => {
      const src = await getTemporaryLink(accessToken, entry.path_lower);
      return {
        id: entry.id,
        name: entry.name,
        path: entry.path_lower,
        src
      } as DropboxPhoto;
    })
  );

  return photos;
};
