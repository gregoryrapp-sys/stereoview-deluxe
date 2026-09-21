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
  is_listed: boolean;
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
  is_listed: boolean;
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
  /**
   * Dropbox albums only. 'live' streams from Dropbox at view time (legacy);
   * 'imported' serves from Storage. Use isLiveDropboxAlbum(), never
   * source_type alone, on read surfaces.
   */
  import_state: AlbumImportState;
  dropbox_last_synced_at: string | null;
  dropbox_last_sync_error: string | null;
  is_public: boolean;
  is_listed: boolean;
  password: string | null;
}

export type AlbumImportState = 'live' | 'importing' | 'imported' | 'failed';

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
  /** Set on photos imported from Dropbox; the sync's identity key. Null = manual upload. */
  dropbox_file_id: string | null;
  dropbox_name: string | null;
  dropbox_rev: string | null;
  dropbox_content_hash: string | null;
  dropbox_size: number | null;
  source_synced_at: string | null;
  /** Soft delete by a Dropbox sync. Readers filter this null; restore is one update. */
  deleted_at: string | null;
}

export type SyncRunStatus = 'planned' | 'applying' | 'verifying' | 'imported' | 'failed' | 'cancelled';

export interface SyncRunRecord {
  id: string;
  album_id: string;
  status: SyncRunStatus;
  listing_complete: boolean;
  plan: unknown;
  cursor: number;
  total_items: number;
  applied: {
    added: number;
    updated: number;
    renamed: number;
    restored: number;
    deleted: number;
    thumbsMissing: number;
  };
  errors: Array<{ name: string; fileId?: string; stage: string; message: string }>;
  confirmed_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

/**
 * One row of public.photographer_directory(). Listed profiles only; private
 * ones carry `has_pin` instead of the hash and no cover fields.
 */
export interface PhotographerDirectoryRow {
  id: string;
  slug: string;
  display_name: string | null;
  created_at: string;
  is_public: boolean;
  has_pin: boolean;
  cover_photo_id: string | null;
  dropbox_cover_album_id: string | null;
  dropbox_cover_image_name: string | null;
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
          import_state?: AlbumImportState;
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
          dropbox_file_id?: string | null;
          dropbox_name?: string | null;
          dropbox_rev?: string | null;
          dropbox_content_hash?: string | null;
          dropbox_size?: number | null;
          source_synced_at?: string | null;
          deleted_at?: string | null;
        };
        Update: Partial<Omit<PhotoRecord, 'id' | 'created_at'>>;
      };
      sync_runs: {
        Row: SyncRunRecord;
        // Written only by the dropbox-sync edge function (service role).
        Insert: never;
        Update: never;
      };
    };
    Functions: {
      // share_links and its three RPCs (create_share_link, verify_share_password,
      // get_shared_gallery_by_slugs) were dropped by migration 20260624000000 but
      // stayed declared here for months. Removed so the types describe the DB
      // that actually exists. get_public_photographers was dropped by
      // 20260921002000 (it returned every profile, public or not).
      photographer_directory: {
        Args: Record<string, never>;
        Returns: PhotographerDirectoryRow[];
      };
    };
  };
}
