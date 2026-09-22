-- 1. Reconcile schema drift, 2. add photos.thumb_path, 3. let thumbnails sign.
--
-- Everything here is idempotent and a no-op against production for (1); it
-- exists so that a fresh database (`supabase db reset`) can run the app at all.

-- ---------------------------------------------------------------------------
-- 1. albums.source_type / albums.dropbox_folder_url
--
-- Both columns exist in production and are read by 20+ call sites, but appear
-- in no migration - they were added through the dashboard. Until now
-- `supabase db reset` produced a database the app could not run against, which
-- is why nothing in this project has been testable locally.
--
-- `if not exists` leaves the production columns exactly as they are (their
-- default and nullability are not touched). The check constraint is NOT VALID
-- so it never fails on a legacy value; new rows are still checked.
-- ---------------------------------------------------------------------------
alter table public.albums
  add column if not exists source_type text not null default 'upload';

alter table public.albums
  add column if not exists dropbox_folder_url text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.albums'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%source_type%'
  ) then
    alter table public.albums
      add constraint albums_source_type_check
      check (source_type in ('upload', 'dropbox')) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. photos.thumb_path
--
-- A small (~1024 px wide) copy of the whole side-by-side image, stored as a
-- sibling object of the original: `.../photos/<id>/stereo.thumb.webp`. Grid
-- tiles load this instead of the 2-4k original. NULL means "not generated";
-- readers fall back to storage_path.
-- ---------------------------------------------------------------------------
alter table public.photos
  add column if not exists thumb_path text;

create unique index if not exists photos_thumb_path_key
  on public.photos (thumb_path)
  where thumb_path is not null;

-- ---------------------------------------------------------------------------
-- 3. can_read_storage_object: match the thumbnail too.
--
-- storage.objects SELECT delegates to this function, which resolves an object
-- path to its photo row by EXACT match on storage_path. A thumbnail at a
-- sibling path therefore could not be signed by anyone - including the owner.
--
-- Matching thumb_path exactly (rather than a folder-prefix rule) keeps the
-- lookup on unique indexes, grants exactly one extra object per photo, and
-- covers the legacy paths written by Admin.tsx
-- (`<owner>/<album>/<timestamp>-<name>`) which have no `/photos/<uuid>/`
-- segment for a prefix rule to key on.
--
-- Body otherwise identical to 20260624000000. The verify_private_access()
-- branch is still dead (nothing mints the claim it reads) and is retained
-- unchanged here so this migration changes one thing.
-- ---------------------------------------------------------------------------
create or replace function public.can_read_storage_object(p_object_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_album_id uuid;
  v_event_id uuid;
  v_owner_id uuid;
begin
  select p.album_id, a.event_id, e.owner_id
    into v_album_id, v_event_id, v_owner_id
    from public.photos p
    join public.albums a on p.album_id = a.id
    join public.events e on a.event_id = e.id
   where p.storage_path = p_object_path
      or p.thumb_path   = p_object_path
   limit 1;

  if v_album_id is null then
    return false; -- not a photo object, or its hierarchy is gone
  end if;

  if auth.uid() = v_owner_id or public.is_admin() then
    return true;
  end if;

  -- Inherited public access: every level must be public.
  if (
    (select is_public from public.profiles where id = v_owner_id) and
    (select is_public from public.events   where id = v_event_id) and
    (select is_public from public.albums   where id = v_album_id)
  ) then
    return true;
  end if;

  -- Inherited PIN access (dead path today; see header).
  if (
    public.verify_private_access(v_album_id) or
    ((select password from public.albums where id = v_album_id) is null
      and public.verify_private_access(v_event_id)) or
    ((select password from public.albums where id = v_album_id) is null
      and (select password from public.events where id = v_event_id) is null
      and public.verify_private_access(v_owner_id))
  ) then
    return true;
  end if;

  return false;
end;
$$;
