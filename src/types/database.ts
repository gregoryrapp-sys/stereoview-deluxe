export type AppRole = 'admin' | 'user';
export type ShareScope = 'profile' | 'event' | 'album';

export interface Profile {
  id: string;
  email: string | null;
  display_name: string | null;
  role: AppRole;
  slug: string;
  cover_photo_id: string | null;
  created_at: string;
}

export interface EventRecord {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  slug: string;
  cover_photo_id: string | null;
  created_at: string;
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
}

export interface PhotoRecord {
  id: string;
  album_id: string;
  storage_path: string;
  alt: string;
  sort_order: number;
  created_at: string;
}

export interface ShareLinkRecord {
  id: string;
  token: string;
  scope: ShareScope;
  profile_id: string | null;
  event_id: string | null;
  album_id: string | null;
  password_hash: string | null;
  created_by: string;
  is_active: boolean;
  expires_at: string | null;
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
          alt: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: Partial<Omit<PhotoRecord, 'id' | 'created_at'>>;
      };
      share_links: {
        Row: ShareLinkRecord;
        Insert: {
          id?: string;
          token?: string;
          scope: ShareScope;
          profile_id?: string | null;
          event_id?: string | null;
          album_id?: string | null;
          password_hash?: string | null;
          created_by: string;
          is_active?: boolean;
          expires_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<ShareLinkRecord, 'id' | 'created_at'>>;
      };
    };
    Functions: {
      create_share_link: {
        Args: {
          p_scope: ShareScope;
          p_profile_id: string | null;
          p_event_id: string | null;
          p_album_id: string | null;
          p_password: string;
          p_expires_at?: string | null;
        };
        Returns: ShareLinkRecord;
      };
      verify_share_password: {
        Args: {
          p_token: string;
          p_password: string;
        };
        Returns: boolean;
      };
      get_shared_gallery_by_slugs: {
        Args: {
          p_profile_slug: string;
          p_event_slug?: string | null;
          p_album_slug?: string | null;
          p_password?: string;
        };
        Returns: unknown;
      };
      get_public_photographers: {
        Args: Record<string, never>;
        Returns: unknown;
      };
    };
  };
}
