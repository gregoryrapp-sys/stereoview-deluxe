import { Album, AppSettings, UserAccount } from './types';

const USERS_KEY = 'stereoview.users';
const CURRENT_USER_KEY = 'stereoview.currentUser';
const ALBUMS_KEY = 'stereoview.albums';
const SETTINGS_KEY = 'stereoview.settings';

const DEFAULT_ADMIN: UserAccount = {
  id: 'admin',
  username: 'admin',
  displayName: 'Administrator',
  password: 'admin123',
  role: 'admin'
};

export const ensureSeedData = () => {
  if (typeof window === 'undefined') return;
  const existingUsers = getUsers();
  if (existingUsers.length === 0) {
    saveUsers([DEFAULT_ADMIN]);
  }
};

export const getUsers = (): UserAccount[] => {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(USERS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as UserAccount[];
  } catch {
    return [];
  }
};

export const saveUsers = (users: UserAccount[]) => {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
};

export const getCurrentUserId = (): string | null => {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(CURRENT_USER_KEY);
};

export const setCurrentUserId = (userId: string | null) => {
  if (userId) {
    localStorage.setItem(CURRENT_USER_KEY, userId);
  } else {
    localStorage.removeItem(CURRENT_USER_KEY);
  }
};

export const getAlbums = (): Album[] => {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(ALBUMS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as Album[];
  } catch {
    return [];
  }
};

export const saveAlbums = (albums: Album[]) => {
  localStorage.setItem(ALBUMS_KEY, JSON.stringify(albums));
};

export const getSettings = (): AppSettings => {
  if (typeof window === 'undefined') {
    return { dropboxAccessToken: '' };
  }
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return { dropboxAccessToken: '' };
  try {
    return JSON.parse(raw) as AppSettings;
  } catch {
    return { dropboxAccessToken: '' };
  }
};

export const saveSettings = (settings: AppSettings) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};
