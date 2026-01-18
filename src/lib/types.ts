export type UserRole = 'admin' | 'user';

export interface UserAccount {
  id: string;
  username: string;
  displayName: string;
  password: string;
  role: UserRole;
}

export interface Album {
  id: string;
  userId: string;
  title: string;
  dropboxFolderUrl: string;
  coverPhotoPath?: string;
  coverPhotoName?: string;
  createdAt: string;
}

export interface AppSettings {
  dropboxAccessToken: string;
}

export interface DropboxPhoto {
  id: string;
  name: string;
  path: string;
  src: string;
}
