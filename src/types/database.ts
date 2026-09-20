export type AppRole = 'admin' | 'user';

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  role: AppRole;
  slug: string;
  cover_photo_id: string | null;
  created_at: string;
  is_public: boolean;
  password: string | null;
  dropbox_cover_album_id: string | null;
  dropbox_cover_image_name: string | null;
}

export interface EventRecord {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  slug: string;
  cover_photo_id: string | null;
  created_at: string;
  dropbox_cover_album_id: string | null;
  dropbox_cover_image_name: string | null;
  is_public: boolean;
  password: string | null;
}

export interface AlbumRecord {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  slug: string;
  cover_photo_id: string | null;
  dropbox_cover_image_name: string | null;
  created_at: string;
  source_type: 'upload' | 'dropbox';
  dropbox_folder_url: string | null;
  is_public: boolean;
  password: string | null;
}

export interface PhotoRecord {
  id: string;
  album_id: string;
  storage_path: string;
  /** Downscaled whole-SBS copy next to the original; null = not generated. */
  thumb_path: string | null;
  alt: string;
  sort_order: number;
  created_at: string;
  file_modified_at: string | null;
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
          slug?: string;
          cover_photo_id?: string | null;
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
          slug?: string;
          cover_photo_id?: string | null;
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
          slug?: string;
          cover_photo_id?: string | null;
          dropbox_cover_image_name?: string | null;
          source_type?: 'upload' | 'dropbox';
          dropbox_folder_url?: string | null;
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
          thumb_path?: string | null;
          alt: string;
          sort_order?: number;
          file_modified_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<PhotoRecord, 'id' | 'created_at'>>;
      };
    };
    Functions: {
      // share_links and its three RPCs (create_share_link, verify_share_password,
      // get_shared_gallery_by_slugs) were dropped by migration 20260624000000 but
      // stayed declared here for months. Removed so the types describe the DB
      // that actually exists.
      get_public_photographers: {
        Args: Record<string, never>;
        Returns: unknown;
      };
    };
  };
}
