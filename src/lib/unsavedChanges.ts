/**
 * Does a management form differ from the record it was loaded from?
 * One function per level; each compares exactly the fields that level's Save
 * button writes. Nulls and empty strings from the database are normalised the
 * same way the page normalises them when it fills the form.
 */

const text = (value: string | null | undefined) => value ?? '';
const id = (value: string | null | undefined) => value ?? null;

export interface AlbumForm {
  title: string; description: string; slug: string;
  coverPhotoId: string | null; dropboxCoverImageName: string | null; dropboxUrl: string;
  isPublic: boolean; isListed: boolean; lrSwappedDefault: boolean; passwordDirty: boolean;
}
export interface AlbumSaved {
  title: string; description?: string | null; slug: string;
  cover_photo_id?: string | null; dropbox_cover_image_name?: string | null; dropbox_folder_url?: string | null;
  is_public?: boolean | null; is_listed?: boolean | null; lr_swapped_default?: boolean | null;
}
export function albumHasUnsavedChanges(f: AlbumForm, a: AlbumSaved): boolean {
  return (
    f.title !== a.title || f.description !== text(a.description) || f.slug !== a.slug ||
    f.coverPhotoId !== id(a.cover_photo_id) || f.dropboxCoverImageName !== id(a.dropbox_cover_image_name) ||
    f.dropboxUrl !== text(a.dropbox_folder_url) || f.isPublic !== (a.is_public ?? true) ||
    f.isListed !== (a.is_listed ?? true) || f.lrSwappedDefault !== (a.lr_swapped_default ?? false) || f.passwordDirty
  );
}

export interface EventForm {
  title: string; description: string; slug: string;
  coverPhotoId: string | null; dropboxCoverAlbumId: string | null; dropboxCoverImageName: string | null;
  isPublic: boolean; isListed: boolean; passwordDirty: boolean;
}
export interface EventSaved {
  title: string; description?: string | null; slug: string;
  cover_photo_id?: string | null; dropbox_cover_album_id?: string | null; dropbox_cover_image_name?: string | null;
  is_public?: boolean | null; is_listed?: boolean | null;
}
export function eventHasUnsavedChanges(f: EventForm, e: EventSaved): boolean {
  return (
    f.title !== e.title || f.description !== text(e.description) || f.slug !== e.slug ||
    f.coverPhotoId !== id(e.cover_photo_id) || f.dropboxCoverAlbumId !== id(e.dropbox_cover_album_id) ||
    f.dropboxCoverImageName !== id(e.dropbox_cover_image_name) || f.isPublic !== (e.is_public ?? true) ||
    f.isListed !== (e.is_listed ?? true) || f.passwordDirty
  );
}

export interface ProfileForm {
  displayName: string; slug: string;
  coverPhotoId: string | null; dropboxCoverAlbumId: string | null; dropboxCoverImageName: string | null;
  isPublic: boolean; isListed: boolean; passwordDirty: boolean;
}
export interface ProfileSaved {
  display_name?: string | null; slug?: string | null;
  cover_photo_id?: string | null; dropbox_cover_album_id?: string | null; dropbox_cover_image_name?: string | null;
  is_public?: boolean | null; is_listed?: boolean | null;
}
export function profileHasUnsavedChanges(f: ProfileForm, p: ProfileSaved): boolean {
  return (
    f.displayName !== text(p.display_name) || f.slug !== text(p.slug) ||
    f.coverPhotoId !== id(p.cover_photo_id) || f.dropboxCoverAlbumId !== id(p.dropbox_cover_album_id) ||
    f.dropboxCoverImageName !== id(p.dropbox_cover_image_name) || f.isPublic !== (p.is_public ?? true) ||
    f.isListed !== (p.is_listed ?? true) || f.passwordDirty
  );
}
