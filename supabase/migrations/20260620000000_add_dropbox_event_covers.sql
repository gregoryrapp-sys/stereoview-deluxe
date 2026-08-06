-- Add columns to events table to allow Dropbox images as event covers.
-- We need both album_id and image_name to uniquely identify a Dropbox photo.
alter table public.events
add column dropbox_cover_album_id uuid references public.albums(id) on delete set null;

alter table public.events
add column dropbox_cover_image_name text;

-- Ensure albums table also has this column (it should already exist from a previous migration).
alter table public.albums
add column if not exists dropbox_cover_image_name text;