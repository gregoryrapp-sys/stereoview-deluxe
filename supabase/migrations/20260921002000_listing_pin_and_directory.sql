-- Access x Listing: two independent switches per profile / event / album.
--
--   is_public  (existing)  true  = anyone with the link can view
--                          false = a PIN is required
--   is_listed  (new)       true  = shown on the Photographers page / in event
--                                  and album lists
--                          false = reachable only by direct link or QR code
--
-- Four combinations fall out: Public+Listed (default), Public+Unlisted (share a
-- QR code, no PIN to type), Private+Listed (card shown with a lock), and
-- Private+Unlisted (link plus PIN).
--
-- Listing is a *rendering* rule, not an access rule. RLS keeps gating on
-- is_public; unlisted rows are simply not rendered in lists by the client and
-- are returned by unlock-access/gallery only when the URL names them.
--
-- THE CASCADE LIVES IN THREE PLACES THAT CHANGE TOGETHER:
--   1. the SELECT policies below
--   2. public.can_read_storage_object (20260624000000)
--   3. supabase/functions/unlock-access/index.ts, action "gallery"
--
-- Everything here is idempotent. Production RLS is known to have drifted from
-- the migration history (dashboard-added policies), so the policy section
-- converges by dropping every SELECT policy on the three tables and recreating
-- the canonical set. Review pg_policies before pushing:
--
--   select tablename, policyname, cmd, qual from pg_policies
--   where schemaname = 'public' and tablename in ('profiles','events','albums');

-- ---------------------------------------------------------------------------
-- 1. Listing flag
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists is_listed boolean not null default true;
alter table public.events   add column if not exists is_listed boolean not null default true;
alter table public.albums   add column if not exists is_listed boolean not null default true;

-- ---------------------------------------------------------------------------
-- 2. Private requires a PIN.
--
-- is_public = false with password = null was reachable from the UI and was a
-- dead end: probe found nothing to unlock and the page reported "not found".
-- The UI now refuses to save that state; this is the database backstop.
--
-- NOT VALID: existing rows are not checked, so a legacy dead-end row keeps
-- working until its owner edits it, at which point the UI walks them to a PIN
-- or to Public. Audit and then `alter table ... validate constraint ...`:
--
--   select 'profiles' t, count(*) from public.profiles where not is_public and password is null
--   union all select 'events', count(*) from public.events  where not is_public and password is null
--   union all select 'albums', count(*) from public.albums  where not is_public and password is null;
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_private_requires_pin') then
    alter table public.profiles
      add constraint profiles_private_requires_pin check (is_public or password is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_private_requires_pin') then
    alter table public.events
      add constraint events_private_requires_pin check (is_public or password is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'albums_private_requires_pin') then
    alter table public.albums
      add constraint albums_private_requires_pin check (is_public or password is not null) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Parent-visibility helpers.
--
-- A policy on events cannot read profiles without re-entering profiles' RLS,
-- and a policy on albums cannot read events for the same reason. SECURITY
-- DEFINER breaks the recursion. Both are stable and cheap (primary-key lookups).
-- ---------------------------------------------------------------------------
create or replace function public.profile_is_public(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_public from public.profiles where id = p_profile_id), false);
$$;

create or replace function public.event_is_public(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select e.is_public and public.profile_is_public(e.owner_id)
       from public.events e
      where e.id = p_event_id),
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Converge the SELECT policies.
--
-- Two changes versus 20260624000000:
--   * The verify_private_access() branches are gone. Nothing ever minted the
--     `unlocked_ids` JWT claim it reads (asymmetric signing keys - Supabase
--     holds the private key), so they were dead. The function itself stays,
--     because can_read_storage_object still references it.
--   * Children are gated by their parents. Previously a public event under a
--     private profile was readable via PostgREST (title, slug) even though the
--     profile page itself was hidden. unlock-access/gallery already gates
--     top-down; RLS now agrees.
--
-- Private rows are never returned to anon by RLS. That is what keeps bcrypt
-- hashes off the wire: unlock-access strips them before returning locked stubs.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and tablename in ('profiles', 'events', 'albums')
       and cmd = 'SELECT'
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

create policy "Public, owners and admins can read profiles"
  on public.profiles for select
  using (is_public = true or auth.uid() = id or public.is_admin());

create policy "Public, owners and admins can read events"
  on public.events for select
  using (
    (is_public = true and public.profile_is_public(owner_id))
    or auth.uid() = owner_id
    or public.is_admin()
  );

create policy "Public, owners and admins can read albums"
  on public.albums for select
  using (
    (is_public = true and public.event_is_public(event_id))
    or public.can_access_event(event_id)
  );

-- photos: unchanged. "Users can read photos in accessible albums" delegates to
-- the albums policy above and needs no listing awareness.

-- ---------------------------------------------------------------------------
-- 5. Photographers directory.
--
-- get_public_photographers() was a SECURITY DEFINER RPC that returned EVERY
-- profile row - no is_public filter - executable by anon. It had no caller in
-- the client, which is the only reason it never leaked anything. Dropped.
--
-- photographer_directory() is its replacement and the home page's data source.
-- It returns listed profiles only, exposes `has_pin` instead of the hash, and
-- withholds cover fields for private profiles (a locked card shows a lock, not
-- the couple's photo).
-- ---------------------------------------------------------------------------
drop function if exists public.get_public_photographers();

create or replace function public.photographer_directory()
returns table (
  id uuid,
  slug text,
  display_name text,
  created_at timestamptz,
  is_public boolean,
  has_pin boolean,
  cover_photo_id uuid,
  dropbox_cover_album_id uuid,
  dropbox_cover_image_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.slug,
    p.display_name,
    p.created_at,
    p.is_public,
    (p.password is not null) as has_pin,
    case when p.is_public then p.cover_photo_id end,
    case when p.is_public then p.dropbox_cover_album_id end,
    case when p.is_public then p.dropbox_cover_image_name end
  from public.profiles p
  where p.is_listed
    and (p.is_public or p.password is not null)
  order by p.created_at desc;
$$;

revoke all on function public.photographer_directory() from public;
grant execute on function public.photographer_directory() to anon, authenticated;
