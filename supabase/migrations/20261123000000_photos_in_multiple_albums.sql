-- ---------------------------------------------------------------------------
-- One photo file, shown in several albums.
--
-- "Copy to album" does not copy the file. It adds another photos row that
-- points at the same storage_path / thumb_path, so each album keeps its own
-- row (name, order, cover choice) while Storage holds one object. Deleting a
-- row removes the file only when no other row still uses it (client side, in
-- galleryService).
--
-- Three things assumed one row per file and change together here:
--   1. storage_path / thumb_path were UNIQUE. Now plain indexes, plus one row
--      per (album, file) so the same photo cannot appear twice in an album.
--   2. A guard: a row may only point at files in its own photographer's
--      folder (`<owner id>/...`, the same rule the storage.objects policies
--      use). Without it, a row in someone's public album could point at
--      another photographer's private file and expose it.
--   3. can_read_storage_object picked one arbitrary row per file (LIMIT 1).
--      With several rows, access is granted if ANY row holding the file
--      grants it, so privacy is decided per album as before.
--
-- Checked before writing: every photo row visible to visitors (692 of them)
-- already has both paths in its owner's folder, so the guard changes nothing
-- for existing data. It runs only when a row's paths or album change.
-- ---------------------------------------------------------------------------

-- 1. Uniqueness: per album, not global ----------------------------------------
-- Production has drifted from the migration history before, so drop whatever
-- unique index or constraint covers exactly (storage_path) or (thumb_path).
do $$
declare
  r record;
begin
  for r in
    select i.relname as index_name, c.conname as constraint_name
      from pg_index x
      join pg_class i on i.oid = x.indexrelid
      join pg_class t on t.oid = x.indrelid
      join pg_namespace n on n.oid = t.relnamespace
      left join pg_constraint c on c.conindid = x.indexrelid
     where n.nspname = 'public'
       and t.relname = 'photos'
       and x.indisunique
       and not x.indisprimary
       and x.indnatts = 1
       and (select attname from pg_attribute where attrelid = t.oid and attnum = x.indkey[0])
           in ('storage_path', 'thumb_path')
  loop
    if r.constraint_name is not null then
      execute format('alter table public.photos drop constraint %I', r.constraint_name);
    else
      execute format('drop index public.%I', r.index_name);
    end if;
  end loop;
end $$;

create index if not exists photos_storage_path_idx on public.photos (storage_path);
create index if not exists photos_thumb_path_idx on public.photos (thumb_path) where thumb_path is not null;
create unique index if not exists photos_album_storage_path_key on public.photos (album_id, storage_path);

-- 2. Guard: files must be in the row's own photographer's folder ---------------
create or replace function public.photos_files_in_owner_folder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  -- The Dropbox sync runs with the service role; admins manage any account.
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' or public.is_admin() then
    return new;
  end if;

  select e.owner_id
    into v_owner_id
    from public.albums a
    join public.events e on e.id = a.event_id
   where a.id = new.album_id;

  if v_owner_id is null
     or (storage.foldername(new.storage_path))[1] is distinct from v_owner_id::text
     or (new.thumb_path is not null
         and (storage.foldername(new.thumb_path))[1] is distinct from v_owner_id::text) then
    raise exception 'A photo can only use files from its own photographer''s folder'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists photos_files_in_owner_folder on public.photos;
create trigger photos_files_in_owner_folder
  before insert or update of storage_path, thumb_path, album_id on public.photos
  for each row execute function public.photos_files_in_owner_folder();

-- 3. Storage read: any row holding the file may grant access --------------------
-- Body otherwise identical to 20260925000000.
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
  -- Owners read everything under their own folder, whether or not a photos
  -- row references it yet (see 20260925000000).
  if auth.uid() is not null and (storage.foldername(p_object_path))[1] = auth.uid()::text then
    return true;
  end if;

  if public.is_admin() then
    return true;
  end if;

  -- One file can be shown in several albums; each may have different
  -- privacy. The file is readable if any of them allows it.
  for v_album_id, v_event_id, v_owner_id in
    select p.album_id, a.event_id, e.owner_id
      from public.photos p
      join public.albums a on p.album_id = a.id
      join public.events e on a.event_id = e.id
     where p.storage_path = p_object_path
        or p.thumb_path   = p_object_path
  loop
    if auth.uid() = v_owner_id then
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

    -- Inherited PIN access (dead path today; see 20260921000000).
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
  end loop;

  return false; -- not a photo object, its hierarchy is gone, or no album allows it
end;
$$;
