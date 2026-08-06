-- This migration updates RLS policies to support the new public/private model,
-- and removes the old share_links system which is now obsolete.

-- 1. Drop old SELECT policies that are too restrictive.
DROP POLICY IF EXISTS "Profiles are visible to owners and admins" ON public.profiles;
DROP POLICY IF EXISTS "Event owners and admins can read events" ON public.events;
DROP POLICY IF EXISTS "Accessible albums are readable" ON public.albums;
DROP POLICY IF EXISTS "Accessible photos are readable" ON public.photos;

-- 2. Create new, more permissive SELECT policies.

-- Policy for profiles
CREATE POLICY "Public, owners, and granted users can read profiles"
ON public.profiles FOR SELECT USING (
  is_public = true
  OR auth.uid() = id
  OR public.is_admin()
  OR public.verify_private_access(id)
);

-- Policy for events
CREATE POLICY "Public, owners, and granted users can read events"
ON public.events FOR SELECT USING (
  is_public = true
  OR auth.uid() = owner_id
  OR public.is_admin()
  OR public.verify_private_access(id) -- direct access to event
  OR (password IS NULL AND public.verify_private_access(owner_id)) -- inherited access from profile
);

-- Policy for albums
CREATE POLICY "Public, owners, and granted users can read albums"
ON public.albums FOR SELECT USING (
  is_public = true
  OR public.can_access_event(event_id) -- This correctly checks for ownership via the event
  OR public.verify_private_access(id) -- direct access to album
  OR (password IS NULL AND public.verify_private_access(event_id)) -- inherited access from event
  OR (password IS NULL AND (SELECT e.password FROM public.events e WHERE e.id = event_id) IS NULL AND public.verify_private_access((SELECT e.owner_id FROM public.events e WHERE e.id = event_id))) -- inherited access from profile
);

-- Policy for photos
CREATE POLICY "Users can read photos in accessible albums"
ON public.photos FOR SELECT USING (
  (SELECT true FROM public.albums WHERE id = photos.album_id)
);


-- 3. Clean up old share_links system.
-- Drop policies that depend on the share_links table or related functions
DROP POLICY IF EXISTS "Public can sign active shared photo objects" ON storage.objects;
DROP POLICY IF EXISTS "Share links are manageable by owners and admins" ON public.share_links;

-- Drop functions that depend on the share_links table or share_scope type
DROP FUNCTION IF EXISTS public.get_shared_gallery_by_slugs(text, text, text, text);
DROP FUNCTION IF EXISTS public.create_share_link(public.share_scope, uuid, uuid, uuid, text, timestamptz);
DROP FUNCTION IF EXISTS public.verify_share_password(text, text);
DROP FUNCTION IF EXISTS public.can_manage_share_link(public.share_links, uuid);

-- Now we can drop the table and the type
DROP TABLE IF EXISTS public.share_links;
DROP TYPE IF EXISTS public.share_scope;

-- 4. Update storage policies
-- The old policy for reading storage objects was tied to share_links.
-- We need a new one for public/password access.
DROP POLICY IF EXISTS "Owners and admins can read photo objects" ON storage.objects;

-- This new function checks if a user can read a storage object based on the new privacy model.
CREATE OR REPLACE FUNCTION public.can_read_storage_object(p_object_path text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_album_id uuid;
  v_event_id uuid;
  v_owner_id uuid;
BEGIN
  -- Get the hierarchy for the photo
  SELECT
    p.album_id, a.event_id, e.owner_id
  INTO
    v_album_id, v_event_id, v_owner_id
  FROM
    public.photos p
    JOIN public.albums a ON p.album_id = a.id
    JOIN public.events e ON a.event_id = e.id
  WHERE
    p.storage_path = p_object_path;

  IF v_album_id IS NULL THEN
    RETURN false; -- Photo or its hierarchy not found
  END IF;

  -- Allow owner and admin
  IF auth.uid() = v_owner_id OR public.is_admin() THEN
    RETURN true;
  END IF;

  -- Check for inherited public access
  IF (
    (SELECT is_public FROM public.profiles WHERE id = v_owner_id) AND
    (SELECT is_public FROM public.events WHERE id = v_event_id) AND
    (SELECT is_public FROM public.albums WHERE id = v_album_id)
  ) THEN
    RETURN true;
  END IF;

  -- Check for inherited password-based access
  IF (
    public.verify_private_access(v_album_id) OR
    ((SELECT password FROM public.albums WHERE id = v_album_id) IS NULL AND public.verify_private_access(v_event_id)) OR
    ((SELECT password FROM public.albums WHERE id = v_album_id) IS NULL AND (SELECT password FROM public.events WHERE id = v_event_id) IS NULL AND public.verify_private_access(v_owner_id))
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

-- New policy for reading storage objects
CREATE POLICY "Public, owners, and granted users can read photo objects"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'photos'
  AND public.can_read_storage_object(name)
);