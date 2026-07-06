-- Add is_public and password columns to profiles, events, and albums tables
-- to support the public-by-default, password-protected privacy model.

alter table public.profiles
add column is_public boolean not null default true;

alter table public.profiles
add column password text;

alter table public.events
add column is_public boolean not null default true;

alter table public.events
add column password text;

alter table public.albums
add column is_public boolean not null default true;

alter table public.albums
add column password text;
