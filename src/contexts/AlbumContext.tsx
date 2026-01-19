import { createContext, useContext, useMemo, useState, ReactNode } from 'react';

export interface Album {
  id: string;
  title: string;
  dropboxFolderLink: string;
  coverImage?: string;
  createdAt: string;
}

interface AlbumContextType {
  albums: Album[];
  addAlbum: (album: Omit<Album, 'id' | 'createdAt'>) => void;
  getAlbum: (id: string) => Album | undefined;
}

const AlbumContext = createContext<AlbumContextType | undefined>(undefined);

const STORAGE_KEY = 'stereoviewAlbums';

function loadAlbums(): Album[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    return JSON.parse(stored) as Album[];
  } catch {
    return [];
  }
}

export function AlbumProvider({ children }: { children: ReactNode }) {
  const [albums, setAlbums] = useState<Album[]>(() => loadAlbums());

  const addAlbum = (album: Omit<Album, 'id' | 'createdAt'>) => {
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const nextAlbum: Album = {
      ...album,
      id,
      createdAt: new Date().toISOString()
    };

    setAlbums((prev) => {
      const updated = [nextAlbum, ...prev];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    });
  };

  const value = useMemo(
    () => ({
      albums,
      addAlbum,
      getAlbum: (id: string) => albums.find((album) => album.id === id)
    }),
    [albums]
  );

  return <AlbumContext.Provider value={value}>{children}</AlbumContext.Provider>;
}

export function useAlbums() {
  const context = useContext(AlbumContext);
  if (!context) {
    throw new Error('useAlbums must be used within an AlbumProvider');
  }
  return context;
}
