export type AppRole = 'admin' | 'user';

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  role: AppRole;
  created_at: string;
}

export interface EventRecord {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  created_at: string;
}

export interface AlbumRecord {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  created_at: string;
}

export interface PhotoRecord {
  id: string;
  album_id: string;
  storage_path: string;
  alt: string;
  sort_order: number;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: {
          id: string;
          email?: string | null;
          display_name?: string | null;
          role?: AppRole;
          created_at?: string;
        };
        Update: Partial<Omit<Profile, 'id' | 'created_at'>>;
      };
      events: {
        Row: EventRecord;
        Insert: {
          id?: string;
          owner_id: string;
          title: string;
          description?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<EventRecord, 'id' | 'created_at'>>;
      };
      albums: {
        Row: AlbumRecord;
        Insert: {
          id?: string;
          event_id: string;
          title: string;
          description?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<AlbumRecord, 'id' | 'created_at'>>;
      };
      photos: {
        Row: PhotoRecord;
        Insert: {
          id?: string;
          album_id: string;
          storage_path: string;
          alt: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Omit<PhotoRecord, 'id' | 'created_at'>>;
      };
    };
  };
}
