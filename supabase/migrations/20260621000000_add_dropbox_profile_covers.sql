-- Add columns to profiles table to allow Dropbox images as profile covers.
alter table public.profiles
add column dropbox_cover_album_id uuid references public.albums(id) on delete set null;

alter table public.profiles
add column dropbox_cover_image_name text;