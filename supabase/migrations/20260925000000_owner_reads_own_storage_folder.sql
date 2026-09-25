-- ---------------------------------------------------------------------------
-- Owners can read objects in their own storage folder again.
--
-- Symptom: "Generate missing thumbnails" and background preparation failed
-- every thumbnail with HTTP 403 "new row violates row-level security policy",
-- while the INSERT and UPDATE policies on storage.objects both allow the
-- owner's folder. The thumbnail upload uses upsert; Storage inserts with
-- RETURNING, and Postgres checks returned rows against the SELECT policy.
-- That policy is can_read_storage_object(name), which only recognises a path
-- once photos.storage_path or photos.thumb_path points at it - never true for
-- a thumbnail that is being created. 20260624000000 dropped the owner read
-- rule when it introduced the function; this restores it inside the function
-- so the single SELECT policy stays in place.
--
-- Body otherwise identical to 20260921000000.
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
  -- Owners read everything under their own folder, whether or not a photos
  -- row references it yet. Storage's upsert returns the inserted row, and
  -- Postgres applies the SELECT policy to that RETURNING; without this rule
  -- a brand-new thumbnail (no thumb_path yet) failed with "new row violates
  -- row-level security policy" even though the INSERT policy allowed it.
  -- Same rule as the insert/update/delete policies on storage.objects, and
  -- the read rule owners had before 20260624000000.
  if auth.uid() is not null and (storage.foldername(p_object_path))[1] = auth.uid()::text then
    return true;
  end if;

  if public.is_admin() then
    return true;
  end if;

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
